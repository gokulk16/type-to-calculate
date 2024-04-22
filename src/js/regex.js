"use strict";

export const COMMENT = /^[\/]{2}(.*?)$/gm;
export const HEADING = /^(.*?):$/gm;
export const VARIABLE = /^\s*([\p{L}_]+) *(=) *([^=]+)$/gmu;
export const WORD = /[\p{L}_]+/gu;
export const SUFFIX = /(\d+(?:\.\d+)?)([KkMB]{1}\b)/g;
export const TAB = /\t/g;
export const CURRENCY_CONVERSION = /\d+\s*(\w{3})\s+(to|in)\s+(\w{3})\b/g;
export const CURRENCY_CONVERSION_KEYWORDS = /\s*(\w{3})\s+(to|in)\s+(\w{3})\b/g; // should be a subset of CURRENCY_CONVERSION

