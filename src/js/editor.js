"use strict";

import * as storage from "./storage.js";
import * as win from "./window.js";
import * as currency from "./currency.js";
import * as constants from "./constants.js";
import * as regex from "./regex.js";
import * as reserved from "./reserved.js";
const Mexp = require('math-expression-evaluator')
const _ = require("lodash");

let editor;
let output;
let docId;
let conversionRates;
let homeCurrency;
let addedMexpTokens = []; // records all tokens are added to mexp while execution. Holds only the token string.
let lastEdit = []; // Last known edit by line
let expressions = []; // All tokenized expressions by line
const mexp = new Mexp();


document.addEventListener("DOMContentLoaded", init);

async function setupHomeCurrency() {
  try {
    const response = await fetch('https://ipapi.co/json/');
    if (!response.ok) {
      throw new Error('Failed to fetch country information');
    }
    const data = await response.json();
    if (!_.isNil(data.currency)) {
      homeCurrency = data.currency.toUpperCase()
    } else if (!_.isNil(data.country)) {
      homeCurrency = currency.getHomeCurrency(data.country);
    } else {
      throw new Error('Failed to obtain country/currency information from ipapi.co');
    }
  } catch (error) {
    console.error("Error while computing home currency using ipapi.co/json", error);
    try {
      const response = await fetch('http://ip-api.com/json/');
      if (!response.ok) {
        throw new Error('Failed to fetch country information from ip-api.com');
      }
      const data = await response.json();
      const country = data.countryCode;
      homeCurrency = currency.getHomeCurrency(country);
    } catch {
      console.error("Error while computing home currency using ip-api.com/json; Falling back to USD as home currency", error);
      homeCurrency = 'USD'; // Fallback currency
    }
  }
}

/**
 * Adds multiple Mexp tokens if they haven't been added already.
 * This function checks each token against a list of already added tokens to prevent duplicates.
 * Preventing duplicates is important here since large no of duplicate/unnecessary tokens can slow down calculations
 * 
 * @param {Array} mexpTokens - An array of tokens to be added to the Mexp instance. Each token is an object
 *                             that must at least contain a 'token' property.
 */
async function addMexpToken(mexpTokens) {
  for (let mexpToken of mexpTokens) {
    if (!addedMexpTokens.includes(mexpToken.token)) {
      mexp.addToken([mexpToken]);
      addedMexpTokens.push(mexpToken.token);
    }
  }
}

async function setupMexp() {
  await setupHomeCurrency()

  // allow x as a multipllcation token
  await addMexpToken([{
    type: 2,
    token: "x",
    show: "&times;",
    value: mexp.math.mul
  }]);

  try {
    // setup conversionRates
    conversionRates = await currency.getConversionRates();

    var homeCurrencyConversionTokens = [];

    // dynamically adding conversion token to convert from one currency to another currency
    // example: '1 usd to gbp' should consider 'usd to gbp' as token and do the conversion
    // example: '1 usd in gbp' should consider 'usd in gbp' as token and do the conversion
    Object.entries(conversionRates).forEach(([fromCurrencyCode, rates]) => {
      // Dynamically add conversion tokens for all supported currencies to home currency
      // example, if 1 USD = 83 INR
      homeCurrencyConversionTokens.push({
        type: 7,
        token: fromCurrencyCode.toLowerCase(),
        show: fromCurrencyCode.toUpperCase(),
        value: function (n) {
          return n * rates[homeCurrency];
        }
      });

    });

    await mexp.addToken([...homeCurrencyConversionTokens])

  } catch (error) {
    console.error("Error setting up currency tokens:", error);
  }

}

function setupDocument() {
  editor = document.getElementById("editor");
  editor.focus();
  output = document.getElementById("output");
  docId = getDocId();
}

function removeOverlay() {
  document.body.classList.remove("loading");
}

function getDocId() {
  let url = window.location.search;
  let params = new URLSearchParams(url);
  let id = params.get("id");

  // Sanity check
  if (id && id !== "undefined") {
    return id;
  } else {
    window.close();
  }
}

async function loadData() {
  let data = await getData();

  if (data.text) {
    editor.innerText = data.text;
    lastEdit = data.text.split("\n");
  }

  updateWindowTitle(data.title);
}

async function getData() {
  return await storage.load(docId, {});
}

function setupListeners() {
  editor.addEventListener("input", onEditorInput, false);
  editor.addEventListener("keydown", onEditorKeydown, false);
  output.addEventListener("click", onOutputClick, false);
  window.addEventListener("resize", onWindowResize);
  chrome.storage.onChanged.addListener(onStorageChanged);
}

let onWindowResize = debounce(async function () {
  let dimensions = await win.getWindowDimensions();
  let docData = await storage.load(docId, {});

  docData.width = dimensions.width;
  docData.height = dimensions.height;

  await storage.save(docId, docData);
}, 500);

async function onEditorInput() {
  parse(editor.innerText);
  await saveData();
}

function parse(value) {
  output.innerText = "";
  tokenize(value);

  updateOutputDisplay();

  lastEdit = value.split("\n");
}

function updateOutputDisplay() {
  let results = getResultTokens();

  for (const [i, result] of results.entries()) {
    let button;
    let span;
    let br = document.createElement("br");
    let value = result.value;
    let len = results.length;
    let localizedValue =
      typeof value === "number"
        ? value.toLocaleString("en-US", { maximumFractionDigits: 15 })
        : value;

    switch (result.type) {
      case "null":
        break;
      case "variable":
      case "result":
        button = document.createElement("button");
        button.innerText = localizedValue;
        button.classList.add("result-btn");
        button.classList.add(result.type);
        button.dataset.value = result.value;
        output.appendChild(button);
        break;
      case "error":
        span = document.createElement("span");
        span.innerText = chrome.i18n.getMessage("error");
        span.setAttribute("title", value);
        span.classList.add(result.type);
        output.appendChild(span);
        break;
    }

    if (len > i + 1) {
      output.appendChild(br);
    }
  }
}

let saveData = debounce(async function () {
  let docData = await storage.load(docId, {});
  let text = editor.innerText;
  let title = getTitle(text);
  let date = new Date().toString();

  if (Object.keys(docData).length <= 0) {
    docData.id = docId;
    docData.type = "document";
  }

  docData.modified = date;
  docData.text = text;
  docData.title = title;

  updateWindowTitle(title);

  await storage.save(docId, docData);
}, 500);

function getTitle(str) {
  if (str.length <= 0) return str;
  let maxLength = 30;
  str = str.trim();
  let split = str.split("\n")[0];
  let substring = split.substring(0, maxLength);

  if (split.length <= maxLength || !substring.includes(" ")) {
    return substring;
  } else {
    return split.substr(0, str.lastIndexOf(" ", maxLength));
  }
}

function debounce(callback, wait) {
  let timeout;

  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => callback.apply(this, args), wait);
  };
}

async function onStorageChanged(changes) {
  if (changes[docId] && !document.hasFocus()) {
    let data = await getData();

    if (data.text) {
      editor.innerText = data.text;
    }
  }
}

function updateWindowTitle(value) {
  if (value && value.length > 0) {
    document.title = value;
  } else {
    document.title = chrome.i18n.getMessage("new_document");
  }
}

function onEditorKeydown(e) {
  let key = e.key;
  switch (key) {
    case "Tab":
      e.preventDefault();
      insertNode("\t");
      break;
  }
}

function insertNode(...nodes) {
  for (let node of nodes) {
    document.execCommand("insertText", false, node);
  }
}

function addCurrencyConversiontokens(currencyConversionStrings) {
  const currencyConversionKeywords = currencyConversionStrings.map(str => str.match(regex.CURRENCY_CONVERSION_KEYWORDS)[0]);

  // find the converstion rate for the specific currency conversion using the conversionRates object
  // then add that one particular token only to mexp, if not added already to addedMexpTokens
  currencyConversionKeywords.forEach(keyword => {
    // Split the keyword to get from and to currency codes

    var [fromCurrency, preposition, toCurrency] = keyword.trim().split(/\s(to|in)\s/);
    fromCurrency = fromCurrency.toUpperCase(), toCurrency = toCurrency.toUpperCase()

    const tokenString = `${fromCurrency.toLowerCase()} ${preposition} ${toCurrency.toLowerCase()}`;

    // Check if this specific conversion token has not been added yet
    if (!addedMexpTokens.includes(tokenString)) {

      // Check if the conversion rate exists for the specified conversion
      if (!_.isEmpty(conversionRates[fromCurrency]) && conversionRates[fromCurrency][toCurrency]) {
        const rate = conversionRates[fromCurrency][toCurrency];
        // Define the conversion token
        const conversionToken = {
          type: 7,
          token: tokenString,
          show: `${fromCurrency.toUpperCase()} ${preposition} ${toCurrency.toUpperCase()}`,
          value: function (n) {
            return n * rate;
          }
        };
        // Add the token to Mexp and mark it as added
        mexp.addToken([conversionToken]);
        addedMexpTokens.push(tokenString);
      }
    }
  });
}

function tokenize(value, src) {
  let lines = value.split("\n");
  let token;

  let isEdited = false;
  let editedVariables = [];

  for (const [i, line] of lines.entries()) {
    let str = line;
    let lastEditStr = lastEdit[i];

    if (str.match(regex.TAB)) {
      str = removeTabs(str);
    }

    if (lastEdit[i] && lastEditStr.match(regex.TAB)) {
      lastEditStr = removeTabs(lastEditStr);
    }

    let comment = str.match(regex.COMMENT);
    let heading = str.match(regex.HEADING);
    let variable = str.match(regex.VARIABLE);
    let words = str.match(regex.WORD);
    let currencyConversion = str.match(regex.CURRENCY_CONVERSION);
    if (currencyConversion) {
      addCurrencyConversiontokens(currencyConversion);
    }

    if (!lastEditStr || str !== lastEditStr) {
      isEdited = true; // Mark lines that are edited
    }

    for (const variable of editedVariables) {
      let nameBoundary = new RegExp(makeRegexBoundary(variable), "gu");

      if (str.match(nameBoundary)) {
        isEdited = true; // Mark lines that contain edited variables
      }
    }

    if (isEdited || src === "init") {
      isEdited = false;

      if (str.length === 0) {
        token = {
          type: "newline",
          value: "",
        };
      } else if (comment || heading) {
        token = {
          type: "comment",
          value: str.trim(),
        };
      } else {
        // Expand abbrebiated numbers
        if (str.match(regex.SUFFIX)) {
          let matches = [...str.matchAll(regex.SUFFIX)];

          for (const match of matches) {
            let m = match[0];
            let value = match[1];
            let modifier = match[2];
            let newValue;

            switch (modifier) {
              case "k":
              case "K":
                newValue = value * 1000;
                str = str.replace(m, newValue);
                break;
              case "M":
                newValue = value * 1000000;
                str = str.replace(m, newValue);
                break;
              case "B":
                newValue = value * 1000000000;
                str = str.replace(m, newValue);
                break;
            }
          }
        }

        if (variable) {
          token = getVariableToken(str, expressions, i);
        } else {
          let tmp = str;

          if (tmp.includes("=")) {
            tmp = tmp.replace("=", "");
          }

          if (words) {
            for (const word of words) {
              let isConstant = validateWord(constants.IDENTIFIERS, word);

              if (isConstant) {
                let find = constants.CONSTANTS.find(
                  (x) => x.indentifier === word
                );
                tmp = replaceTextWithValue(tmp, word, find.value);
              }

              let obj = expressions.find((x) => x.name === word);
              tmp = obj ? replaceTextWithValue(tmp, word, obj.value) : tmp;
            }
          }

          if (hasNumber(tmp)) {
            let result;
            let val = tmp.trim();

            try {
              result = mexp.eval(val);
            } catch (err) {
              result;
            }

            token = {
              type: "expression",
              value: tmp.trim(),
              result: result,
            };
          } else {
            token = {
              type: "comment",
              value: tmp.trim(),
            };
          }
        }
      }

      expressions[i] = token;
    }
  }

  function getVariableToken(str, expressions, i) {
    let split = str.split("=");
    let name = split[0].trim();
    let value = split[1].trim();

    if (expressions[i] && expressions[i].name !== name) {
      // If the variable name is modified...
      editedVariables.push(expressions[i].name); // Store the previous name...
      editedVariables.push(name); // And the new name
    } else {
      editedVariables.push(name);
    }

    let isReserved = validateWord(reserved.IDENTIFIERS, name);
    let isExistingVariableIndex = expressions.findIndex((x) => x.name === name);

    if (isReserved) {
      return {
        type: "error",
        name: name,
        value: chrome.i18n.getMessage("error_invalid_variable"),
      };
    }

    if (isExistingVariableIndex < i && isExistingVariableIndex !== -1) {
      return {
        type: "error",
        name: name,
        value: chrome.i18n.getMessage("error_duplicate_variable"),
      };
    }

    let words = value.match(regex.WORD);

    if (words) {
      for (const word of words) {
        let isConstant = validateWord(constants.IDENTIFIERS, word);

        if (isConstant) {
          let find = constants.CONSTANTS.find((x) => x.indentifier === word);
          value = replaceTextWithValue(value, word, find.value);
        }

        let obj = expressions.find((x) => x.name === word);
        value = obj
          ? replaceTextWithValue(value, word, obj.value)
          : value.replace(word, "");
      }
    }

    let boundary = /^(\d+(?:\.\d+)?)$/gm; // Any number with optional decimal point

    if (!value.match(boundary)) {
      try {
        value = mexp.eval(value);
      } catch (err) {
        console.log('waiting for boundary in the expression')
      }
    }

    value = Number(value);

    if (isNaN(value)) {
      value = "";
    }

    return {
      type: "variable",
      name: name,
      value: value,
    };
  }

  function replaceTextWithValue(str, find, replace) {
    return str.replace(new RegExp(makeRegexBoundary(find), "giu"), replace);
  }

  function makeRegexBoundary(str) {
    return "(?<=^|\\P{L})" + str + "(?=\\P{L}|$)";
  }

  function hasNumber(str) {
    return /\d/.test(str);
  }

  if (expressions.length !== lines.length) {
    expressions.length = lines.length;
  }

  editedVariables = []; // Reset
}

function removeTabs(value) {
  return value.replace(/\t/g, "");
}

function getResultTokens() {
  let results = [];

  for (const expression of expressions) {
    switch (expression.type) {
      case "newline":
      case "comment":
        results.push({
          type: "null",
          value: "",
        });
        break;
      case "variable":
        results.push({
          type: "variable",
          value: expression.value,
          name: expression.name,
        });
        break;
      case "error":
        results.push({
          type: "error",
          value: expression.value,
        });
        break;
      case "expression":

        if (isNaN(expression.result) || expression.result == null) {
          results.push({
            type: "null",
            value: "",
          });
        } else {
          results.push({
            type: "result",
            value: expression.result,
          });
        }
        break;
    }
  }

  return results;
}

function validateWord(arr, word) {
  let status = arr.includes(word);

  return status;
}

function onOutputClick(e) {
  let shiftPressed = e.shiftKey;
  let classes = ["result", "variable"];

  if (classes.some((className) => e.target.classList.contains(className))) {
    let value = e.target.dataset.value;

    if (!shiftPressed) {
      insertNode(value);
    } else {
      copyValueToClipboard(value);
    }
  }
}

async function copyValueToClipboard(value) {
  try {
    await navigator.clipboard.writeText(value);
  } catch (err) {
    alert(chrome.i18n.getMessage("clipboard_failure"));
  }
}

async function init() {
  setupDocument();
  await loadData();
  await setupMexp();

  setupListeners();
  tokenize(editor.innerText, "init");
  updateOutputDisplay();
  removeOverlay();
}