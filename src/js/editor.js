"use strict";

import * as storage from "./storage.js";
import * as win from "./window.js";
import * as currency from "./currency.js";
import * as regex from "./regex.js";
const _ = require("lodash");
const math = require('mathjs')

let editor;
let output;
let docId;
let conversionRates;
let homeCurrency;
let evaluatedValues = []; // All evaluated expressions by line


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
  } finally {
    math.createUnit(homeCurrency.toLowerCase())
  }
}

async function setupEvaluator() {
  await setupHomeCurrency()

  try {
    // setup conversionRates
    conversionRates = await currency.getConversionRates();

    // dynamically adding conversion token to convert from one currency to another currency
    // example: '1 usd to gbp' should consider 'usd to gbp' as token and do the conversion
    // example: '1 usd in gbp' should consider 'usd in gbp' as token and do the conversion
    Object.entries(conversionRates).forEach(([fromCurrencyCode, rates]) => {
      // Dynamically add conversion tokens for all supported currencies to home currency
      // example, if 1 USD = 83 INR

      if (fromCurrencyCode !== homeCurrency) {
        try {
          math.createUnit(fromCurrencyCode.toLowerCase(), math.unit(1 * rates[homeCurrency], homeCurrency.toLowerCase()));
        } catch {
          try {
            math.createUnit(fromCurrencyCode.toUpperCase(), math.unit(1 * rates[homeCurrency], homeCurrency.toLowerCase()));
          } catch {
            console.log(`couldnt add ${fromCurrencyCode.toUpperCase()} or ${fromCurrencyCode.toLowerCase()} as currency unit`)
          }
        }
      }
    });
  } catch (error) {
    console.error("Error setting up currency tokens:", error);
  }

}

function useMathJs(lines) {
  var mjs_results = [];

  // if any line contains 'x' as a ,utiplication operator. 
  // example: 'data x 2', 'data x2', '2x2', '2 x2', '2x 2', '2 x 2', '2x data', '2 x data'
  // then convert the 'x' to '*' in that line
  lines = lines.map(line => line.replace(regex.X_AS_MULTIPLICATION, '$1 * $2'));
  mjs_results = math.evaluate(lines);
  for (const [i, result] of mjs_results.entries()) {
    try {
      if (!_.isNumber(result)) {
        mjs_results[i] = result.toNumber()
      }
    } catch (error) {
      console.log('no result for line ', i + 1)
    }
  }
  return mjs_results;
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
  evaluate(value);
  updateOutputDisplay();
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

function evaluate(value, src) {
  let lines = value.split("\n");
  let results = useMathJs(lines);
  for (let index = 0; index < results.length; index++) {
    const result_expression = {
      type: "expression",
      value: lines[index].trim(),
      result: results[index],
    };
    evaluatedValues.push(result_expression)
  }
}

function getResultTokens() {
  let results = [];

  for (const expression of evaluatedValues) {
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
  await setupEvaluator();

  setupListeners();
  evaluate(editor.innerText, "init");
  updateOutputDisplay();
  removeOverlay();
}