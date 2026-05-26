// src/plugin.ts
import { mkdirSync as mkdirSync2, writeFileSync as writeFileSync2 } from "fs";
import { homedir as homedir5 } from "os";
import { dirname as dirname2, join as join4 } from "path";

// src/config/agent-loader.ts
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "fs";

// node_modules/js-yaml/dist/js-yaml.mjs
/*! js-yaml 4.1.1 https://github.com/nodeca/js-yaml @license MIT */
function isNothing(subject) {
  return typeof subject === "undefined" || subject === null;
}
function isObject(subject) {
  return typeof subject === "object" && subject !== null;
}
function toArray(sequence) {
  if (Array.isArray(sequence))
    return sequence;
  else if (isNothing(sequence))
    return [];
  return [sequence];
}
function extend(target, source) {
  var index, length, key, sourceKeys;
  if (source) {
    sourceKeys = Object.keys(source);
    for (index = 0, length = sourceKeys.length;index < length; index += 1) {
      key = sourceKeys[index];
      target[key] = source[key];
    }
  }
  return target;
}
function repeat(string, count) {
  var result = "", cycle;
  for (cycle = 0;cycle < count; cycle += 1) {
    result += string;
  }
  return result;
}
function isNegativeZero(number) {
  return number === 0 && Number.NEGATIVE_INFINITY === 1 / number;
}
var isNothing_1 = isNothing;
var isObject_1 = isObject;
var toArray_1 = toArray;
var repeat_1 = repeat;
var isNegativeZero_1 = isNegativeZero;
var extend_1 = extend;
var common = {
  isNothing: isNothing_1,
  isObject: isObject_1,
  toArray: toArray_1,
  repeat: repeat_1,
  isNegativeZero: isNegativeZero_1,
  extend: extend_1
};
function formatError(exception, compact) {
  var where = "", message = exception.reason || "(unknown reason)";
  if (!exception.mark)
    return message;
  if (exception.mark.name) {
    where += 'in "' + exception.mark.name + '" ';
  }
  where += "(" + (exception.mark.line + 1) + ":" + (exception.mark.column + 1) + ")";
  if (!compact && exception.mark.snippet) {
    where += `

` + exception.mark.snippet;
  }
  return message + " " + where;
}
function YAMLException$1(reason, mark) {
  Error.call(this);
  this.name = "YAMLException";
  this.reason = reason;
  this.mark = mark;
  this.message = formatError(this, false);
  if (Error.captureStackTrace) {
    Error.captureStackTrace(this, this.constructor);
  } else {
    this.stack = new Error().stack || "";
  }
}
YAMLException$1.prototype = Object.create(Error.prototype);
YAMLException$1.prototype.constructor = YAMLException$1;
YAMLException$1.prototype.toString = function toString(compact) {
  return this.name + ": " + formatError(this, compact);
};
var exception = YAMLException$1;
function getLine(buffer, lineStart, lineEnd, position, maxLineLength) {
  var head = "";
  var tail = "";
  var maxHalfLength = Math.floor(maxLineLength / 2) - 1;
  if (position - lineStart > maxHalfLength) {
    head = " ... ";
    lineStart = position - maxHalfLength + head.length;
  }
  if (lineEnd - position > maxHalfLength) {
    tail = " ...";
    lineEnd = position + maxHalfLength - tail.length;
  }
  return {
    str: head + buffer.slice(lineStart, lineEnd).replace(/\t/g, "→") + tail,
    pos: position - lineStart + head.length
  };
}
function padStart(string, max) {
  return common.repeat(" ", max - string.length) + string;
}
function makeSnippet(mark, options) {
  options = Object.create(options || null);
  if (!mark.buffer)
    return null;
  if (!options.maxLength)
    options.maxLength = 79;
  if (typeof options.indent !== "number")
    options.indent = 1;
  if (typeof options.linesBefore !== "number")
    options.linesBefore = 3;
  if (typeof options.linesAfter !== "number")
    options.linesAfter = 2;
  var re = /\r?\n|\r|\0/g;
  var lineStarts = [0];
  var lineEnds = [];
  var match;
  var foundLineNo = -1;
  while (match = re.exec(mark.buffer)) {
    lineEnds.push(match.index);
    lineStarts.push(match.index + match[0].length);
    if (mark.position <= match.index && foundLineNo < 0) {
      foundLineNo = lineStarts.length - 2;
    }
  }
  if (foundLineNo < 0)
    foundLineNo = lineStarts.length - 1;
  var result = "", i, line;
  var lineNoLength = Math.min(mark.line + options.linesAfter, lineEnds.length).toString().length;
  var maxLineLength = options.maxLength - (options.indent + lineNoLength + 3);
  for (i = 1;i <= options.linesBefore; i++) {
    if (foundLineNo - i < 0)
      break;
    line = getLine(mark.buffer, lineStarts[foundLineNo - i], lineEnds[foundLineNo - i], mark.position - (lineStarts[foundLineNo] - lineStarts[foundLineNo - i]), maxLineLength);
    result = common.repeat(" ", options.indent) + padStart((mark.line - i + 1).toString(), lineNoLength) + " | " + line.str + `
` + result;
  }
  line = getLine(mark.buffer, lineStarts[foundLineNo], lineEnds[foundLineNo], mark.position, maxLineLength);
  result += common.repeat(" ", options.indent) + padStart((mark.line + 1).toString(), lineNoLength) + " | " + line.str + `
`;
  result += common.repeat("-", options.indent + lineNoLength + 3 + line.pos) + "^" + `
`;
  for (i = 1;i <= options.linesAfter; i++) {
    if (foundLineNo + i >= lineEnds.length)
      break;
    line = getLine(mark.buffer, lineStarts[foundLineNo + i], lineEnds[foundLineNo + i], mark.position - (lineStarts[foundLineNo] - lineStarts[foundLineNo + i]), maxLineLength);
    result += common.repeat(" ", options.indent) + padStart((mark.line + i + 1).toString(), lineNoLength) + " | " + line.str + `
`;
  }
  return result.replace(/\n$/, "");
}
var snippet = makeSnippet;
var TYPE_CONSTRUCTOR_OPTIONS = [
  "kind",
  "multi",
  "resolve",
  "construct",
  "instanceOf",
  "predicate",
  "represent",
  "representName",
  "defaultStyle",
  "styleAliases"
];
var YAML_NODE_KINDS = [
  "scalar",
  "sequence",
  "mapping"
];
function compileStyleAliases(map) {
  var result = {};
  if (map !== null) {
    Object.keys(map).forEach(function(style) {
      map[style].forEach(function(alias) {
        result[String(alias)] = style;
      });
    });
  }
  return result;
}
function Type$1(tag, options) {
  options = options || {};
  Object.keys(options).forEach(function(name) {
    if (TYPE_CONSTRUCTOR_OPTIONS.indexOf(name) === -1) {
      throw new exception('Unknown option "' + name + '" is met in definition of "' + tag + '" YAML type.');
    }
  });
  this.options = options;
  this.tag = tag;
  this.kind = options["kind"] || null;
  this.resolve = options["resolve"] || function() {
    return true;
  };
  this.construct = options["construct"] || function(data) {
    return data;
  };
  this.instanceOf = options["instanceOf"] || null;
  this.predicate = options["predicate"] || null;
  this.represent = options["represent"] || null;
  this.representName = options["representName"] || null;
  this.defaultStyle = options["defaultStyle"] || null;
  this.multi = options["multi"] || false;
  this.styleAliases = compileStyleAliases(options["styleAliases"] || null);
  if (YAML_NODE_KINDS.indexOf(this.kind) === -1) {
    throw new exception('Unknown kind "' + this.kind + '" is specified for "' + tag + '" YAML type.');
  }
}
var type = Type$1;
function compileList(schema, name) {
  var result = [];
  schema[name].forEach(function(currentType) {
    var newIndex = result.length;
    result.forEach(function(previousType, previousIndex) {
      if (previousType.tag === currentType.tag && previousType.kind === currentType.kind && previousType.multi === currentType.multi) {
        newIndex = previousIndex;
      }
    });
    result[newIndex] = currentType;
  });
  return result;
}
function compileMap() {
  var result = {
    scalar: {},
    sequence: {},
    mapping: {},
    fallback: {},
    multi: {
      scalar: [],
      sequence: [],
      mapping: [],
      fallback: []
    }
  }, index, length;
  function collectType(type2) {
    if (type2.multi) {
      result.multi[type2.kind].push(type2);
      result.multi["fallback"].push(type2);
    } else {
      result[type2.kind][type2.tag] = result["fallback"][type2.tag] = type2;
    }
  }
  for (index = 0, length = arguments.length;index < length; index += 1) {
    arguments[index].forEach(collectType);
  }
  return result;
}
function Schema$1(definition) {
  return this.extend(definition);
}
Schema$1.prototype.extend = function extend2(definition) {
  var implicit = [];
  var explicit = [];
  if (definition instanceof type) {
    explicit.push(definition);
  } else if (Array.isArray(definition)) {
    explicit = explicit.concat(definition);
  } else if (definition && (Array.isArray(definition.implicit) || Array.isArray(definition.explicit))) {
    if (definition.implicit)
      implicit = implicit.concat(definition.implicit);
    if (definition.explicit)
      explicit = explicit.concat(definition.explicit);
  } else {
    throw new exception("Schema.extend argument should be a Type, [ Type ], " + "or a schema definition ({ implicit: [...], explicit: [...] })");
  }
  implicit.forEach(function(type$1) {
    if (!(type$1 instanceof type)) {
      throw new exception("Specified list of YAML types (or a single Type object) contains a non-Type object.");
    }
    if (type$1.loadKind && type$1.loadKind !== "scalar") {
      throw new exception("There is a non-scalar type in the implicit list of a schema. Implicit resolving of such types is not supported.");
    }
    if (type$1.multi) {
      throw new exception("There is a multi type in the implicit list of a schema. Multi tags can only be listed as explicit.");
    }
  });
  explicit.forEach(function(type$1) {
    if (!(type$1 instanceof type)) {
      throw new exception("Specified list of YAML types (or a single Type object) contains a non-Type object.");
    }
  });
  var result = Object.create(Schema$1.prototype);
  result.implicit = (this.implicit || []).concat(implicit);
  result.explicit = (this.explicit || []).concat(explicit);
  result.compiledImplicit = compileList(result, "implicit");
  result.compiledExplicit = compileList(result, "explicit");
  result.compiledTypeMap = compileMap(result.compiledImplicit, result.compiledExplicit);
  return result;
};
var schema = Schema$1;
var str = new type("tag:yaml.org,2002:str", {
  kind: "scalar",
  construct: function(data) {
    return data !== null ? data : "";
  }
});
var seq = new type("tag:yaml.org,2002:seq", {
  kind: "sequence",
  construct: function(data) {
    return data !== null ? data : [];
  }
});
var map = new type("tag:yaml.org,2002:map", {
  kind: "mapping",
  construct: function(data) {
    return data !== null ? data : {};
  }
});
var failsafe = new schema({
  explicit: [
    str,
    seq,
    map
  ]
});
function resolveYamlNull(data) {
  if (data === null)
    return true;
  var max = data.length;
  return max === 1 && data === "~" || max === 4 && (data === "null" || data === "Null" || data === "NULL");
}
function constructYamlNull() {
  return null;
}
function isNull(object) {
  return object === null;
}
var _null = new type("tag:yaml.org,2002:null", {
  kind: "scalar",
  resolve: resolveYamlNull,
  construct: constructYamlNull,
  predicate: isNull,
  represent: {
    canonical: function() {
      return "~";
    },
    lowercase: function() {
      return "null";
    },
    uppercase: function() {
      return "NULL";
    },
    camelcase: function() {
      return "Null";
    },
    empty: function() {
      return "";
    }
  },
  defaultStyle: "lowercase"
});
function resolveYamlBoolean(data) {
  if (data === null)
    return false;
  var max = data.length;
  return max === 4 && (data === "true" || data === "True" || data === "TRUE") || max === 5 && (data === "false" || data === "False" || data === "FALSE");
}
function constructYamlBoolean(data) {
  return data === "true" || data === "True" || data === "TRUE";
}
function isBoolean(object) {
  return Object.prototype.toString.call(object) === "[object Boolean]";
}
var bool = new type("tag:yaml.org,2002:bool", {
  kind: "scalar",
  resolve: resolveYamlBoolean,
  construct: constructYamlBoolean,
  predicate: isBoolean,
  represent: {
    lowercase: function(object) {
      return object ? "true" : "false";
    },
    uppercase: function(object) {
      return object ? "TRUE" : "FALSE";
    },
    camelcase: function(object) {
      return object ? "True" : "False";
    }
  },
  defaultStyle: "lowercase"
});
function isHexCode(c) {
  return 48 <= c && c <= 57 || 65 <= c && c <= 70 || 97 <= c && c <= 102;
}
function isOctCode(c) {
  return 48 <= c && c <= 55;
}
function isDecCode(c) {
  return 48 <= c && c <= 57;
}
function resolveYamlInteger(data) {
  if (data === null)
    return false;
  var max = data.length, index = 0, hasDigits = false, ch;
  if (!max)
    return false;
  ch = data[index];
  if (ch === "-" || ch === "+") {
    ch = data[++index];
  }
  if (ch === "0") {
    if (index + 1 === max)
      return true;
    ch = data[++index];
    if (ch === "b") {
      index++;
      for (;index < max; index++) {
        ch = data[index];
        if (ch === "_")
          continue;
        if (ch !== "0" && ch !== "1")
          return false;
        hasDigits = true;
      }
      return hasDigits && ch !== "_";
    }
    if (ch === "x") {
      index++;
      for (;index < max; index++) {
        ch = data[index];
        if (ch === "_")
          continue;
        if (!isHexCode(data.charCodeAt(index)))
          return false;
        hasDigits = true;
      }
      return hasDigits && ch !== "_";
    }
    if (ch === "o") {
      index++;
      for (;index < max; index++) {
        ch = data[index];
        if (ch === "_")
          continue;
        if (!isOctCode(data.charCodeAt(index)))
          return false;
        hasDigits = true;
      }
      return hasDigits && ch !== "_";
    }
  }
  if (ch === "_")
    return false;
  for (;index < max; index++) {
    ch = data[index];
    if (ch === "_")
      continue;
    if (!isDecCode(data.charCodeAt(index))) {
      return false;
    }
    hasDigits = true;
  }
  if (!hasDigits || ch === "_")
    return false;
  return true;
}
function constructYamlInteger(data) {
  var value = data, sign = 1, ch;
  if (value.indexOf("_") !== -1) {
    value = value.replace(/_/g, "");
  }
  ch = value[0];
  if (ch === "-" || ch === "+") {
    if (ch === "-")
      sign = -1;
    value = value.slice(1);
    ch = value[0];
  }
  if (value === "0")
    return 0;
  if (ch === "0") {
    if (value[1] === "b")
      return sign * parseInt(value.slice(2), 2);
    if (value[1] === "x")
      return sign * parseInt(value.slice(2), 16);
    if (value[1] === "o")
      return sign * parseInt(value.slice(2), 8);
  }
  return sign * parseInt(value, 10);
}
function isInteger(object) {
  return Object.prototype.toString.call(object) === "[object Number]" && (object % 1 === 0 && !common.isNegativeZero(object));
}
var int = new type("tag:yaml.org,2002:int", {
  kind: "scalar",
  resolve: resolveYamlInteger,
  construct: constructYamlInteger,
  predicate: isInteger,
  represent: {
    binary: function(obj) {
      return obj >= 0 ? "0b" + obj.toString(2) : "-0b" + obj.toString(2).slice(1);
    },
    octal: function(obj) {
      return obj >= 0 ? "0o" + obj.toString(8) : "-0o" + obj.toString(8).slice(1);
    },
    decimal: function(obj) {
      return obj.toString(10);
    },
    hexadecimal: function(obj) {
      return obj >= 0 ? "0x" + obj.toString(16).toUpperCase() : "-0x" + obj.toString(16).toUpperCase().slice(1);
    }
  },
  defaultStyle: "decimal",
  styleAliases: {
    binary: [2, "bin"],
    octal: [8, "oct"],
    decimal: [10, "dec"],
    hexadecimal: [16, "hex"]
  }
});
var YAML_FLOAT_PATTERN = new RegExp("^(?:[-+]?(?:[0-9][0-9_]*)(?:\\.[0-9_]*)?(?:[eE][-+]?[0-9]+)?" + "|\\.[0-9_]+(?:[eE][-+]?[0-9]+)?" + "|[-+]?\\.(?:inf|Inf|INF)" + "|\\.(?:nan|NaN|NAN))$");
function resolveYamlFloat(data) {
  if (data === null)
    return false;
  if (!YAML_FLOAT_PATTERN.test(data) || data[data.length - 1] === "_") {
    return false;
  }
  return true;
}
function constructYamlFloat(data) {
  var value, sign;
  value = data.replace(/_/g, "").toLowerCase();
  sign = value[0] === "-" ? -1 : 1;
  if ("+-".indexOf(value[0]) >= 0) {
    value = value.slice(1);
  }
  if (value === ".inf") {
    return sign === 1 ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
  } else if (value === ".nan") {
    return NaN;
  }
  return sign * parseFloat(value, 10);
}
var SCIENTIFIC_WITHOUT_DOT = /^[-+]?[0-9]+e/;
function representYamlFloat(object, style) {
  var res;
  if (isNaN(object)) {
    switch (style) {
      case "lowercase":
        return ".nan";
      case "uppercase":
        return ".NAN";
      case "camelcase":
        return ".NaN";
    }
  } else if (Number.POSITIVE_INFINITY === object) {
    switch (style) {
      case "lowercase":
        return ".inf";
      case "uppercase":
        return ".INF";
      case "camelcase":
        return ".Inf";
    }
  } else if (Number.NEGATIVE_INFINITY === object) {
    switch (style) {
      case "lowercase":
        return "-.inf";
      case "uppercase":
        return "-.INF";
      case "camelcase":
        return "-.Inf";
    }
  } else if (common.isNegativeZero(object)) {
    return "-0.0";
  }
  res = object.toString(10);
  return SCIENTIFIC_WITHOUT_DOT.test(res) ? res.replace("e", ".e") : res;
}
function isFloat(object) {
  return Object.prototype.toString.call(object) === "[object Number]" && (object % 1 !== 0 || common.isNegativeZero(object));
}
var float = new type("tag:yaml.org,2002:float", {
  kind: "scalar",
  resolve: resolveYamlFloat,
  construct: constructYamlFloat,
  predicate: isFloat,
  represent: representYamlFloat,
  defaultStyle: "lowercase"
});
var json = failsafe.extend({
  implicit: [
    _null,
    bool,
    int,
    float
  ]
});
var core = json;
var YAML_DATE_REGEXP = new RegExp("^([0-9][0-9][0-9][0-9])" + "-([0-9][0-9])" + "-([0-9][0-9])$");
var YAML_TIMESTAMP_REGEXP = new RegExp("^([0-9][0-9][0-9][0-9])" + "-([0-9][0-9]?)" + "-([0-9][0-9]?)" + "(?:[Tt]|[ \\t]+)" + "([0-9][0-9]?)" + ":([0-9][0-9])" + ":([0-9][0-9])" + "(?:\\.([0-9]*))?" + "(?:[ \\t]*(Z|([-+])([0-9][0-9]?)" + "(?::([0-9][0-9]))?))?$");
function resolveYamlTimestamp(data) {
  if (data === null)
    return false;
  if (YAML_DATE_REGEXP.exec(data) !== null)
    return true;
  if (YAML_TIMESTAMP_REGEXP.exec(data) !== null)
    return true;
  return false;
}
function constructYamlTimestamp(data) {
  var match, year, month, day, hour, minute, second, fraction = 0, delta = null, tz_hour, tz_minute, date;
  match = YAML_DATE_REGEXP.exec(data);
  if (match === null)
    match = YAML_TIMESTAMP_REGEXP.exec(data);
  if (match === null)
    throw new Error("Date resolve error");
  year = +match[1];
  month = +match[2] - 1;
  day = +match[3];
  if (!match[4]) {
    return new Date(Date.UTC(year, month, day));
  }
  hour = +match[4];
  minute = +match[5];
  second = +match[6];
  if (match[7]) {
    fraction = match[7].slice(0, 3);
    while (fraction.length < 3) {
      fraction += "0";
    }
    fraction = +fraction;
  }
  if (match[9]) {
    tz_hour = +match[10];
    tz_minute = +(match[11] || 0);
    delta = (tz_hour * 60 + tz_minute) * 60000;
    if (match[9] === "-")
      delta = -delta;
  }
  date = new Date(Date.UTC(year, month, day, hour, minute, second, fraction));
  if (delta)
    date.setTime(date.getTime() - delta);
  return date;
}
function representYamlTimestamp(object) {
  return object.toISOString();
}
var timestamp = new type("tag:yaml.org,2002:timestamp", {
  kind: "scalar",
  resolve: resolveYamlTimestamp,
  construct: constructYamlTimestamp,
  instanceOf: Date,
  represent: representYamlTimestamp
});
function resolveYamlMerge(data) {
  return data === "<<" || data === null;
}
var merge = new type("tag:yaml.org,2002:merge", {
  kind: "scalar",
  resolve: resolveYamlMerge
});
var BASE64_MAP = `ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=
\r`;
function resolveYamlBinary(data) {
  if (data === null)
    return false;
  var code, idx, bitlen = 0, max = data.length, map2 = BASE64_MAP;
  for (idx = 0;idx < max; idx++) {
    code = map2.indexOf(data.charAt(idx));
    if (code > 64)
      continue;
    if (code < 0)
      return false;
    bitlen += 6;
  }
  return bitlen % 8 === 0;
}
function constructYamlBinary(data) {
  var idx, tailbits, input = data.replace(/[\r\n=]/g, ""), max = input.length, map2 = BASE64_MAP, bits = 0, result = [];
  for (idx = 0;idx < max; idx++) {
    if (idx % 4 === 0 && idx) {
      result.push(bits >> 16 & 255);
      result.push(bits >> 8 & 255);
      result.push(bits & 255);
    }
    bits = bits << 6 | map2.indexOf(input.charAt(idx));
  }
  tailbits = max % 4 * 6;
  if (tailbits === 0) {
    result.push(bits >> 16 & 255);
    result.push(bits >> 8 & 255);
    result.push(bits & 255);
  } else if (tailbits === 18) {
    result.push(bits >> 10 & 255);
    result.push(bits >> 2 & 255);
  } else if (tailbits === 12) {
    result.push(bits >> 4 & 255);
  }
  return new Uint8Array(result);
}
function representYamlBinary(object) {
  var result = "", bits = 0, idx, tail, max = object.length, map2 = BASE64_MAP;
  for (idx = 0;idx < max; idx++) {
    if (idx % 3 === 0 && idx) {
      result += map2[bits >> 18 & 63];
      result += map2[bits >> 12 & 63];
      result += map2[bits >> 6 & 63];
      result += map2[bits & 63];
    }
    bits = (bits << 8) + object[idx];
  }
  tail = max % 3;
  if (tail === 0) {
    result += map2[bits >> 18 & 63];
    result += map2[bits >> 12 & 63];
    result += map2[bits >> 6 & 63];
    result += map2[bits & 63];
  } else if (tail === 2) {
    result += map2[bits >> 10 & 63];
    result += map2[bits >> 4 & 63];
    result += map2[bits << 2 & 63];
    result += map2[64];
  } else if (tail === 1) {
    result += map2[bits >> 2 & 63];
    result += map2[bits << 4 & 63];
    result += map2[64];
    result += map2[64];
  }
  return result;
}
function isBinary(obj) {
  return Object.prototype.toString.call(obj) === "[object Uint8Array]";
}
var binary = new type("tag:yaml.org,2002:binary", {
  kind: "scalar",
  resolve: resolveYamlBinary,
  construct: constructYamlBinary,
  predicate: isBinary,
  represent: representYamlBinary
});
var _hasOwnProperty$3 = Object.prototype.hasOwnProperty;
var _toString$2 = Object.prototype.toString;
function resolveYamlOmap(data) {
  if (data === null)
    return true;
  var objectKeys = [], index, length, pair, pairKey, pairHasKey, object = data;
  for (index = 0, length = object.length;index < length; index += 1) {
    pair = object[index];
    pairHasKey = false;
    if (_toString$2.call(pair) !== "[object Object]")
      return false;
    for (pairKey in pair) {
      if (_hasOwnProperty$3.call(pair, pairKey)) {
        if (!pairHasKey)
          pairHasKey = true;
        else
          return false;
      }
    }
    if (!pairHasKey)
      return false;
    if (objectKeys.indexOf(pairKey) === -1)
      objectKeys.push(pairKey);
    else
      return false;
  }
  return true;
}
function constructYamlOmap(data) {
  return data !== null ? data : [];
}
var omap = new type("tag:yaml.org,2002:omap", {
  kind: "sequence",
  resolve: resolveYamlOmap,
  construct: constructYamlOmap
});
var _toString$1 = Object.prototype.toString;
function resolveYamlPairs(data) {
  if (data === null)
    return true;
  var index, length, pair, keys, result, object = data;
  result = new Array(object.length);
  for (index = 0, length = object.length;index < length; index += 1) {
    pair = object[index];
    if (_toString$1.call(pair) !== "[object Object]")
      return false;
    keys = Object.keys(pair);
    if (keys.length !== 1)
      return false;
    result[index] = [keys[0], pair[keys[0]]];
  }
  return true;
}
function constructYamlPairs(data) {
  if (data === null)
    return [];
  var index, length, pair, keys, result, object = data;
  result = new Array(object.length);
  for (index = 0, length = object.length;index < length; index += 1) {
    pair = object[index];
    keys = Object.keys(pair);
    result[index] = [keys[0], pair[keys[0]]];
  }
  return result;
}
var pairs = new type("tag:yaml.org,2002:pairs", {
  kind: "sequence",
  resolve: resolveYamlPairs,
  construct: constructYamlPairs
});
var _hasOwnProperty$2 = Object.prototype.hasOwnProperty;
function resolveYamlSet(data) {
  if (data === null)
    return true;
  var key, object = data;
  for (key in object) {
    if (_hasOwnProperty$2.call(object, key)) {
      if (object[key] !== null)
        return false;
    }
  }
  return true;
}
function constructYamlSet(data) {
  return data !== null ? data : {};
}
var set = new type("tag:yaml.org,2002:set", {
  kind: "mapping",
  resolve: resolveYamlSet,
  construct: constructYamlSet
});
var _default = core.extend({
  implicit: [
    timestamp,
    merge
  ],
  explicit: [
    binary,
    omap,
    pairs,
    set
  ]
});
var _hasOwnProperty$1 = Object.prototype.hasOwnProperty;
var CONTEXT_FLOW_IN = 1;
var CONTEXT_FLOW_OUT = 2;
var CONTEXT_BLOCK_IN = 3;
var CONTEXT_BLOCK_OUT = 4;
var CHOMPING_CLIP = 1;
var CHOMPING_STRIP = 2;
var CHOMPING_KEEP = 3;
var PATTERN_NON_PRINTABLE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x84\x86-\x9F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:[^\uD800-\uDBFF]|^)[\uDC00-\uDFFF]/;
var PATTERN_NON_ASCII_LINE_BREAKS = /[\x85\u2028\u2029]/;
var PATTERN_FLOW_INDICATORS = /[,\[\]\{\}]/;
var PATTERN_TAG_HANDLE = /^(?:!|!!|![a-z\-]+!)$/i;
var PATTERN_TAG_URI = /^(?:!|[^,\[\]\{\}])(?:%[0-9a-f]{2}|[0-9a-z\-#;\/\?:@&=\+\$,_\.!~\*'\(\)\[\]])*$/i;
function _class(obj) {
  return Object.prototype.toString.call(obj);
}
function is_EOL(c) {
  return c === 10 || c === 13;
}
function is_WHITE_SPACE(c) {
  return c === 9 || c === 32;
}
function is_WS_OR_EOL(c) {
  return c === 9 || c === 32 || c === 10 || c === 13;
}
function is_FLOW_INDICATOR(c) {
  return c === 44 || c === 91 || c === 93 || c === 123 || c === 125;
}
function fromHexCode(c) {
  var lc;
  if (48 <= c && c <= 57) {
    return c - 48;
  }
  lc = c | 32;
  if (97 <= lc && lc <= 102) {
    return lc - 97 + 10;
  }
  return -1;
}
function escapedHexLen(c) {
  if (c === 120) {
    return 2;
  }
  if (c === 117) {
    return 4;
  }
  if (c === 85) {
    return 8;
  }
  return 0;
}
function fromDecimalCode(c) {
  if (48 <= c && c <= 57) {
    return c - 48;
  }
  return -1;
}
function simpleEscapeSequence(c) {
  return c === 48 ? "\x00" : c === 97 ? "\x07" : c === 98 ? "\b" : c === 116 ? "\t" : c === 9 ? "\t" : c === 110 ? `
` : c === 118 ? "\v" : c === 102 ? "\f" : c === 114 ? "\r" : c === 101 ? "\x1B" : c === 32 ? " " : c === 34 ? '"' : c === 47 ? "/" : c === 92 ? "\\" : c === 78 ? "" : c === 95 ? " " : c === 76 ? "\u2028" : c === 80 ? "\u2029" : "";
}
function charFromCodepoint(c) {
  if (c <= 65535) {
    return String.fromCharCode(c);
  }
  return String.fromCharCode((c - 65536 >> 10) + 55296, (c - 65536 & 1023) + 56320);
}
function setProperty(object, key, value) {
  if (key === "__proto__") {
    Object.defineProperty(object, key, {
      configurable: true,
      enumerable: true,
      writable: true,
      value
    });
  } else {
    object[key] = value;
  }
}
var simpleEscapeCheck = new Array(256);
var simpleEscapeMap = new Array(256);
for (i = 0;i < 256; i++) {
  simpleEscapeCheck[i] = simpleEscapeSequence(i) ? 1 : 0;
  simpleEscapeMap[i] = simpleEscapeSequence(i);
}
var i;
function State$1(input, options) {
  this.input = input;
  this.filename = options["filename"] || null;
  this.schema = options["schema"] || _default;
  this.onWarning = options["onWarning"] || null;
  this.legacy = options["legacy"] || false;
  this.json = options["json"] || false;
  this.listener = options["listener"] || null;
  this.implicitTypes = this.schema.compiledImplicit;
  this.typeMap = this.schema.compiledTypeMap;
  this.length = input.length;
  this.position = 0;
  this.line = 0;
  this.lineStart = 0;
  this.lineIndent = 0;
  this.firstTabInLine = -1;
  this.documents = [];
}
function generateError(state, message) {
  var mark = {
    name: state.filename,
    buffer: state.input.slice(0, -1),
    position: state.position,
    line: state.line,
    column: state.position - state.lineStart
  };
  mark.snippet = snippet(mark);
  return new exception(message, mark);
}
function throwError(state, message) {
  throw generateError(state, message);
}
function throwWarning(state, message) {
  if (state.onWarning) {
    state.onWarning.call(null, generateError(state, message));
  }
}
var directiveHandlers = {
  YAML: function handleYamlDirective(state, name, args) {
    var match, major, minor;
    if (state.version !== null) {
      throwError(state, "duplication of %YAML directive");
    }
    if (args.length !== 1) {
      throwError(state, "YAML directive accepts exactly one argument");
    }
    match = /^([0-9]+)\.([0-9]+)$/.exec(args[0]);
    if (match === null) {
      throwError(state, "ill-formed argument of the YAML directive");
    }
    major = parseInt(match[1], 10);
    minor = parseInt(match[2], 10);
    if (major !== 1) {
      throwError(state, "unacceptable YAML version of the document");
    }
    state.version = args[0];
    state.checkLineBreaks = minor < 2;
    if (minor !== 1 && minor !== 2) {
      throwWarning(state, "unsupported YAML version of the document");
    }
  },
  TAG: function handleTagDirective(state, name, args) {
    var handle, prefix;
    if (args.length !== 2) {
      throwError(state, "TAG directive accepts exactly two arguments");
    }
    handle = args[0];
    prefix = args[1];
    if (!PATTERN_TAG_HANDLE.test(handle)) {
      throwError(state, "ill-formed tag handle (first argument) of the TAG directive");
    }
    if (_hasOwnProperty$1.call(state.tagMap, handle)) {
      throwError(state, 'there is a previously declared suffix for "' + handle + '" tag handle');
    }
    if (!PATTERN_TAG_URI.test(prefix)) {
      throwError(state, "ill-formed tag prefix (second argument) of the TAG directive");
    }
    try {
      prefix = decodeURIComponent(prefix);
    } catch (err) {
      throwError(state, "tag prefix is malformed: " + prefix);
    }
    state.tagMap[handle] = prefix;
  }
};
function captureSegment(state, start, end, checkJson) {
  var _position, _length, _character, _result;
  if (start < end) {
    _result = state.input.slice(start, end);
    if (checkJson) {
      for (_position = 0, _length = _result.length;_position < _length; _position += 1) {
        _character = _result.charCodeAt(_position);
        if (!(_character === 9 || 32 <= _character && _character <= 1114111)) {
          throwError(state, "expected valid JSON character");
        }
      }
    } else if (PATTERN_NON_PRINTABLE.test(_result)) {
      throwError(state, "the stream contains non-printable characters");
    }
    state.result += _result;
  }
}
function mergeMappings(state, destination, source, overridableKeys) {
  var sourceKeys, key, index, quantity;
  if (!common.isObject(source)) {
    throwError(state, "cannot merge mappings; the provided source object is unacceptable");
  }
  sourceKeys = Object.keys(source);
  for (index = 0, quantity = sourceKeys.length;index < quantity; index += 1) {
    key = sourceKeys[index];
    if (!_hasOwnProperty$1.call(destination, key)) {
      setProperty(destination, key, source[key]);
      overridableKeys[key] = true;
    }
  }
}
function storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, valueNode, startLine, startLineStart, startPos) {
  var index, quantity;
  if (Array.isArray(keyNode)) {
    keyNode = Array.prototype.slice.call(keyNode);
    for (index = 0, quantity = keyNode.length;index < quantity; index += 1) {
      if (Array.isArray(keyNode[index])) {
        throwError(state, "nested arrays are not supported inside keys");
      }
      if (typeof keyNode === "object" && _class(keyNode[index]) === "[object Object]") {
        keyNode[index] = "[object Object]";
      }
    }
  }
  if (typeof keyNode === "object" && _class(keyNode) === "[object Object]") {
    keyNode = "[object Object]";
  }
  keyNode = String(keyNode);
  if (_result === null) {
    _result = {};
  }
  if (keyTag === "tag:yaml.org,2002:merge") {
    if (Array.isArray(valueNode)) {
      for (index = 0, quantity = valueNode.length;index < quantity; index += 1) {
        mergeMappings(state, _result, valueNode[index], overridableKeys);
      }
    } else {
      mergeMappings(state, _result, valueNode, overridableKeys);
    }
  } else {
    if (!state.json && !_hasOwnProperty$1.call(overridableKeys, keyNode) && _hasOwnProperty$1.call(_result, keyNode)) {
      state.line = startLine || state.line;
      state.lineStart = startLineStart || state.lineStart;
      state.position = startPos || state.position;
      throwError(state, "duplicated mapping key");
    }
    setProperty(_result, keyNode, valueNode);
    delete overridableKeys[keyNode];
  }
  return _result;
}
function readLineBreak(state) {
  var ch;
  ch = state.input.charCodeAt(state.position);
  if (ch === 10) {
    state.position++;
  } else if (ch === 13) {
    state.position++;
    if (state.input.charCodeAt(state.position) === 10) {
      state.position++;
    }
  } else {
    throwError(state, "a line break is expected");
  }
  state.line += 1;
  state.lineStart = state.position;
  state.firstTabInLine = -1;
}
function skipSeparationSpace(state, allowComments, checkIndent) {
  var lineBreaks = 0, ch = state.input.charCodeAt(state.position);
  while (ch !== 0) {
    while (is_WHITE_SPACE(ch)) {
      if (ch === 9 && state.firstTabInLine === -1) {
        state.firstTabInLine = state.position;
      }
      ch = state.input.charCodeAt(++state.position);
    }
    if (allowComments && ch === 35) {
      do {
        ch = state.input.charCodeAt(++state.position);
      } while (ch !== 10 && ch !== 13 && ch !== 0);
    }
    if (is_EOL(ch)) {
      readLineBreak(state);
      ch = state.input.charCodeAt(state.position);
      lineBreaks++;
      state.lineIndent = 0;
      while (ch === 32) {
        state.lineIndent++;
        ch = state.input.charCodeAt(++state.position);
      }
    } else {
      break;
    }
  }
  if (checkIndent !== -1 && lineBreaks !== 0 && state.lineIndent < checkIndent) {
    throwWarning(state, "deficient indentation");
  }
  return lineBreaks;
}
function testDocumentSeparator(state) {
  var _position = state.position, ch;
  ch = state.input.charCodeAt(_position);
  if ((ch === 45 || ch === 46) && ch === state.input.charCodeAt(_position + 1) && ch === state.input.charCodeAt(_position + 2)) {
    _position += 3;
    ch = state.input.charCodeAt(_position);
    if (ch === 0 || is_WS_OR_EOL(ch)) {
      return true;
    }
  }
  return false;
}
function writeFoldedLines(state, count) {
  if (count === 1) {
    state.result += " ";
  } else if (count > 1) {
    state.result += common.repeat(`
`, count - 1);
  }
}
function readPlainScalar(state, nodeIndent, withinFlowCollection) {
  var preceding, following, captureStart, captureEnd, hasPendingContent, _line, _lineStart, _lineIndent, _kind = state.kind, _result = state.result, ch;
  ch = state.input.charCodeAt(state.position);
  if (is_WS_OR_EOL(ch) || is_FLOW_INDICATOR(ch) || ch === 35 || ch === 38 || ch === 42 || ch === 33 || ch === 124 || ch === 62 || ch === 39 || ch === 34 || ch === 37 || ch === 64 || ch === 96) {
    return false;
  }
  if (ch === 63 || ch === 45) {
    following = state.input.charCodeAt(state.position + 1);
    if (is_WS_OR_EOL(following) || withinFlowCollection && is_FLOW_INDICATOR(following)) {
      return false;
    }
  }
  state.kind = "scalar";
  state.result = "";
  captureStart = captureEnd = state.position;
  hasPendingContent = false;
  while (ch !== 0) {
    if (ch === 58) {
      following = state.input.charCodeAt(state.position + 1);
      if (is_WS_OR_EOL(following) || withinFlowCollection && is_FLOW_INDICATOR(following)) {
        break;
      }
    } else if (ch === 35) {
      preceding = state.input.charCodeAt(state.position - 1);
      if (is_WS_OR_EOL(preceding)) {
        break;
      }
    } else if (state.position === state.lineStart && testDocumentSeparator(state) || withinFlowCollection && is_FLOW_INDICATOR(ch)) {
      break;
    } else if (is_EOL(ch)) {
      _line = state.line;
      _lineStart = state.lineStart;
      _lineIndent = state.lineIndent;
      skipSeparationSpace(state, false, -1);
      if (state.lineIndent >= nodeIndent) {
        hasPendingContent = true;
        ch = state.input.charCodeAt(state.position);
        continue;
      } else {
        state.position = captureEnd;
        state.line = _line;
        state.lineStart = _lineStart;
        state.lineIndent = _lineIndent;
        break;
      }
    }
    if (hasPendingContent) {
      captureSegment(state, captureStart, captureEnd, false);
      writeFoldedLines(state, state.line - _line);
      captureStart = captureEnd = state.position;
      hasPendingContent = false;
    }
    if (!is_WHITE_SPACE(ch)) {
      captureEnd = state.position + 1;
    }
    ch = state.input.charCodeAt(++state.position);
  }
  captureSegment(state, captureStart, captureEnd, false);
  if (state.result) {
    return true;
  }
  state.kind = _kind;
  state.result = _result;
  return false;
}
function readSingleQuotedScalar(state, nodeIndent) {
  var ch, captureStart, captureEnd;
  ch = state.input.charCodeAt(state.position);
  if (ch !== 39) {
    return false;
  }
  state.kind = "scalar";
  state.result = "";
  state.position++;
  captureStart = captureEnd = state.position;
  while ((ch = state.input.charCodeAt(state.position)) !== 0) {
    if (ch === 39) {
      captureSegment(state, captureStart, state.position, true);
      ch = state.input.charCodeAt(++state.position);
      if (ch === 39) {
        captureStart = state.position;
        state.position++;
        captureEnd = state.position;
      } else {
        return true;
      }
    } else if (is_EOL(ch)) {
      captureSegment(state, captureStart, captureEnd, true);
      writeFoldedLines(state, skipSeparationSpace(state, false, nodeIndent));
      captureStart = captureEnd = state.position;
    } else if (state.position === state.lineStart && testDocumentSeparator(state)) {
      throwError(state, "unexpected end of the document within a single quoted scalar");
    } else {
      state.position++;
      captureEnd = state.position;
    }
  }
  throwError(state, "unexpected end of the stream within a single quoted scalar");
}
function readDoubleQuotedScalar(state, nodeIndent) {
  var captureStart, captureEnd, hexLength, hexResult, tmp, ch;
  ch = state.input.charCodeAt(state.position);
  if (ch !== 34) {
    return false;
  }
  state.kind = "scalar";
  state.result = "";
  state.position++;
  captureStart = captureEnd = state.position;
  while ((ch = state.input.charCodeAt(state.position)) !== 0) {
    if (ch === 34) {
      captureSegment(state, captureStart, state.position, true);
      state.position++;
      return true;
    } else if (ch === 92) {
      captureSegment(state, captureStart, state.position, true);
      ch = state.input.charCodeAt(++state.position);
      if (is_EOL(ch)) {
        skipSeparationSpace(state, false, nodeIndent);
      } else if (ch < 256 && simpleEscapeCheck[ch]) {
        state.result += simpleEscapeMap[ch];
        state.position++;
      } else if ((tmp = escapedHexLen(ch)) > 0) {
        hexLength = tmp;
        hexResult = 0;
        for (;hexLength > 0; hexLength--) {
          ch = state.input.charCodeAt(++state.position);
          if ((tmp = fromHexCode(ch)) >= 0) {
            hexResult = (hexResult << 4) + tmp;
          } else {
            throwError(state, "expected hexadecimal character");
          }
        }
        state.result += charFromCodepoint(hexResult);
        state.position++;
      } else {
        throwError(state, "unknown escape sequence");
      }
      captureStart = captureEnd = state.position;
    } else if (is_EOL(ch)) {
      captureSegment(state, captureStart, captureEnd, true);
      writeFoldedLines(state, skipSeparationSpace(state, false, nodeIndent));
      captureStart = captureEnd = state.position;
    } else if (state.position === state.lineStart && testDocumentSeparator(state)) {
      throwError(state, "unexpected end of the document within a double quoted scalar");
    } else {
      state.position++;
      captureEnd = state.position;
    }
  }
  throwError(state, "unexpected end of the stream within a double quoted scalar");
}
function readFlowCollection(state, nodeIndent) {
  var readNext = true, _line, _lineStart, _pos, _tag = state.tag, _result, _anchor = state.anchor, following, terminator, isPair, isExplicitPair, isMapping, overridableKeys = Object.create(null), keyNode, keyTag, valueNode, ch;
  ch = state.input.charCodeAt(state.position);
  if (ch === 91) {
    terminator = 93;
    isMapping = false;
    _result = [];
  } else if (ch === 123) {
    terminator = 125;
    isMapping = true;
    _result = {};
  } else {
    return false;
  }
  if (state.anchor !== null) {
    state.anchorMap[state.anchor] = _result;
  }
  ch = state.input.charCodeAt(++state.position);
  while (ch !== 0) {
    skipSeparationSpace(state, true, nodeIndent);
    ch = state.input.charCodeAt(state.position);
    if (ch === terminator) {
      state.position++;
      state.tag = _tag;
      state.anchor = _anchor;
      state.kind = isMapping ? "mapping" : "sequence";
      state.result = _result;
      return true;
    } else if (!readNext) {
      throwError(state, "missed comma between flow collection entries");
    } else if (ch === 44) {
      throwError(state, "expected the node content, but found ','");
    }
    keyTag = keyNode = valueNode = null;
    isPair = isExplicitPair = false;
    if (ch === 63) {
      following = state.input.charCodeAt(state.position + 1);
      if (is_WS_OR_EOL(following)) {
        isPair = isExplicitPair = true;
        state.position++;
        skipSeparationSpace(state, true, nodeIndent);
      }
    }
    _line = state.line;
    _lineStart = state.lineStart;
    _pos = state.position;
    composeNode(state, nodeIndent, CONTEXT_FLOW_IN, false, true);
    keyTag = state.tag;
    keyNode = state.result;
    skipSeparationSpace(state, true, nodeIndent);
    ch = state.input.charCodeAt(state.position);
    if ((isExplicitPair || state.line === _line) && ch === 58) {
      isPair = true;
      ch = state.input.charCodeAt(++state.position);
      skipSeparationSpace(state, true, nodeIndent);
      composeNode(state, nodeIndent, CONTEXT_FLOW_IN, false, true);
      valueNode = state.result;
    }
    if (isMapping) {
      storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, valueNode, _line, _lineStart, _pos);
    } else if (isPair) {
      _result.push(storeMappingPair(state, null, overridableKeys, keyTag, keyNode, valueNode, _line, _lineStart, _pos));
    } else {
      _result.push(keyNode);
    }
    skipSeparationSpace(state, true, nodeIndent);
    ch = state.input.charCodeAt(state.position);
    if (ch === 44) {
      readNext = true;
      ch = state.input.charCodeAt(++state.position);
    } else {
      readNext = false;
    }
  }
  throwError(state, "unexpected end of the stream within a flow collection");
}
function readBlockScalar(state, nodeIndent) {
  var captureStart, folding, chomping = CHOMPING_CLIP, didReadContent = false, detectedIndent = false, textIndent = nodeIndent, emptyLines = 0, atMoreIndented = false, tmp, ch;
  ch = state.input.charCodeAt(state.position);
  if (ch === 124) {
    folding = false;
  } else if (ch === 62) {
    folding = true;
  } else {
    return false;
  }
  state.kind = "scalar";
  state.result = "";
  while (ch !== 0) {
    ch = state.input.charCodeAt(++state.position);
    if (ch === 43 || ch === 45) {
      if (CHOMPING_CLIP === chomping) {
        chomping = ch === 43 ? CHOMPING_KEEP : CHOMPING_STRIP;
      } else {
        throwError(state, "repeat of a chomping mode identifier");
      }
    } else if ((tmp = fromDecimalCode(ch)) >= 0) {
      if (tmp === 0) {
        throwError(state, "bad explicit indentation width of a block scalar; it cannot be less than one");
      } else if (!detectedIndent) {
        textIndent = nodeIndent + tmp - 1;
        detectedIndent = true;
      } else {
        throwError(state, "repeat of an indentation width identifier");
      }
    } else {
      break;
    }
  }
  if (is_WHITE_SPACE(ch)) {
    do {
      ch = state.input.charCodeAt(++state.position);
    } while (is_WHITE_SPACE(ch));
    if (ch === 35) {
      do {
        ch = state.input.charCodeAt(++state.position);
      } while (!is_EOL(ch) && ch !== 0);
    }
  }
  while (ch !== 0) {
    readLineBreak(state);
    state.lineIndent = 0;
    ch = state.input.charCodeAt(state.position);
    while ((!detectedIndent || state.lineIndent < textIndent) && ch === 32) {
      state.lineIndent++;
      ch = state.input.charCodeAt(++state.position);
    }
    if (!detectedIndent && state.lineIndent > textIndent) {
      textIndent = state.lineIndent;
    }
    if (is_EOL(ch)) {
      emptyLines++;
      continue;
    }
    if (state.lineIndent < textIndent) {
      if (chomping === CHOMPING_KEEP) {
        state.result += common.repeat(`
`, didReadContent ? 1 + emptyLines : emptyLines);
      } else if (chomping === CHOMPING_CLIP) {
        if (didReadContent) {
          state.result += `
`;
        }
      }
      break;
    }
    if (folding) {
      if (is_WHITE_SPACE(ch)) {
        atMoreIndented = true;
        state.result += common.repeat(`
`, didReadContent ? 1 + emptyLines : emptyLines);
      } else if (atMoreIndented) {
        atMoreIndented = false;
        state.result += common.repeat(`
`, emptyLines + 1);
      } else if (emptyLines === 0) {
        if (didReadContent) {
          state.result += " ";
        }
      } else {
        state.result += common.repeat(`
`, emptyLines);
      }
    } else {
      state.result += common.repeat(`
`, didReadContent ? 1 + emptyLines : emptyLines);
    }
    didReadContent = true;
    detectedIndent = true;
    emptyLines = 0;
    captureStart = state.position;
    while (!is_EOL(ch) && ch !== 0) {
      ch = state.input.charCodeAt(++state.position);
    }
    captureSegment(state, captureStart, state.position, false);
  }
  return true;
}
function readBlockSequence(state, nodeIndent) {
  var _line, _tag = state.tag, _anchor = state.anchor, _result = [], following, detected = false, ch;
  if (state.firstTabInLine !== -1)
    return false;
  if (state.anchor !== null) {
    state.anchorMap[state.anchor] = _result;
  }
  ch = state.input.charCodeAt(state.position);
  while (ch !== 0) {
    if (state.firstTabInLine !== -1) {
      state.position = state.firstTabInLine;
      throwError(state, "tab characters must not be used in indentation");
    }
    if (ch !== 45) {
      break;
    }
    following = state.input.charCodeAt(state.position + 1);
    if (!is_WS_OR_EOL(following)) {
      break;
    }
    detected = true;
    state.position++;
    if (skipSeparationSpace(state, true, -1)) {
      if (state.lineIndent <= nodeIndent) {
        _result.push(null);
        ch = state.input.charCodeAt(state.position);
        continue;
      }
    }
    _line = state.line;
    composeNode(state, nodeIndent, CONTEXT_BLOCK_IN, false, true);
    _result.push(state.result);
    skipSeparationSpace(state, true, -1);
    ch = state.input.charCodeAt(state.position);
    if ((state.line === _line || state.lineIndent > nodeIndent) && ch !== 0) {
      throwError(state, "bad indentation of a sequence entry");
    } else if (state.lineIndent < nodeIndent) {
      break;
    }
  }
  if (detected) {
    state.tag = _tag;
    state.anchor = _anchor;
    state.kind = "sequence";
    state.result = _result;
    return true;
  }
  return false;
}
function readBlockMapping(state, nodeIndent, flowIndent) {
  var following, allowCompact, _line, _keyLine, _keyLineStart, _keyPos, _tag = state.tag, _anchor = state.anchor, _result = {}, overridableKeys = Object.create(null), keyTag = null, keyNode = null, valueNode = null, atExplicitKey = false, detected = false, ch;
  if (state.firstTabInLine !== -1)
    return false;
  if (state.anchor !== null) {
    state.anchorMap[state.anchor] = _result;
  }
  ch = state.input.charCodeAt(state.position);
  while (ch !== 0) {
    if (!atExplicitKey && state.firstTabInLine !== -1) {
      state.position = state.firstTabInLine;
      throwError(state, "tab characters must not be used in indentation");
    }
    following = state.input.charCodeAt(state.position + 1);
    _line = state.line;
    if ((ch === 63 || ch === 58) && is_WS_OR_EOL(following)) {
      if (ch === 63) {
        if (atExplicitKey) {
          storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, null, _keyLine, _keyLineStart, _keyPos);
          keyTag = keyNode = valueNode = null;
        }
        detected = true;
        atExplicitKey = true;
        allowCompact = true;
      } else if (atExplicitKey) {
        atExplicitKey = false;
        allowCompact = true;
      } else {
        throwError(state, "incomplete explicit mapping pair; a key node is missed; or followed by a non-tabulated empty line");
      }
      state.position += 1;
      ch = following;
    } else {
      _keyLine = state.line;
      _keyLineStart = state.lineStart;
      _keyPos = state.position;
      if (!composeNode(state, flowIndent, CONTEXT_FLOW_OUT, false, true)) {
        break;
      }
      if (state.line === _line) {
        ch = state.input.charCodeAt(state.position);
        while (is_WHITE_SPACE(ch)) {
          ch = state.input.charCodeAt(++state.position);
        }
        if (ch === 58) {
          ch = state.input.charCodeAt(++state.position);
          if (!is_WS_OR_EOL(ch)) {
            throwError(state, "a whitespace character is expected after the key-value separator within a block mapping");
          }
          if (atExplicitKey) {
            storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, null, _keyLine, _keyLineStart, _keyPos);
            keyTag = keyNode = valueNode = null;
          }
          detected = true;
          atExplicitKey = false;
          allowCompact = false;
          keyTag = state.tag;
          keyNode = state.result;
        } else if (detected) {
          throwError(state, "can not read an implicit mapping pair; a colon is missed");
        } else {
          state.tag = _tag;
          state.anchor = _anchor;
          return true;
        }
      } else if (detected) {
        throwError(state, "can not read a block mapping entry; a multiline key may not be an implicit key");
      } else {
        state.tag = _tag;
        state.anchor = _anchor;
        return true;
      }
    }
    if (state.line === _line || state.lineIndent > nodeIndent) {
      if (atExplicitKey) {
        _keyLine = state.line;
        _keyLineStart = state.lineStart;
        _keyPos = state.position;
      }
      if (composeNode(state, nodeIndent, CONTEXT_BLOCK_OUT, true, allowCompact)) {
        if (atExplicitKey) {
          keyNode = state.result;
        } else {
          valueNode = state.result;
        }
      }
      if (!atExplicitKey) {
        storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, valueNode, _keyLine, _keyLineStart, _keyPos);
        keyTag = keyNode = valueNode = null;
      }
      skipSeparationSpace(state, true, -1);
      ch = state.input.charCodeAt(state.position);
    }
    if ((state.line === _line || state.lineIndent > nodeIndent) && ch !== 0) {
      throwError(state, "bad indentation of a mapping entry");
    } else if (state.lineIndent < nodeIndent) {
      break;
    }
  }
  if (atExplicitKey) {
    storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, null, _keyLine, _keyLineStart, _keyPos);
  }
  if (detected) {
    state.tag = _tag;
    state.anchor = _anchor;
    state.kind = "mapping";
    state.result = _result;
  }
  return detected;
}
function readTagProperty(state) {
  var _position, isVerbatim = false, isNamed = false, tagHandle, tagName, ch;
  ch = state.input.charCodeAt(state.position);
  if (ch !== 33)
    return false;
  if (state.tag !== null) {
    throwError(state, "duplication of a tag property");
  }
  ch = state.input.charCodeAt(++state.position);
  if (ch === 60) {
    isVerbatim = true;
    ch = state.input.charCodeAt(++state.position);
  } else if (ch === 33) {
    isNamed = true;
    tagHandle = "!!";
    ch = state.input.charCodeAt(++state.position);
  } else {
    tagHandle = "!";
  }
  _position = state.position;
  if (isVerbatim) {
    do {
      ch = state.input.charCodeAt(++state.position);
    } while (ch !== 0 && ch !== 62);
    if (state.position < state.length) {
      tagName = state.input.slice(_position, state.position);
      ch = state.input.charCodeAt(++state.position);
    } else {
      throwError(state, "unexpected end of the stream within a verbatim tag");
    }
  } else {
    while (ch !== 0 && !is_WS_OR_EOL(ch)) {
      if (ch === 33) {
        if (!isNamed) {
          tagHandle = state.input.slice(_position - 1, state.position + 1);
          if (!PATTERN_TAG_HANDLE.test(tagHandle)) {
            throwError(state, "named tag handle cannot contain such characters");
          }
          isNamed = true;
          _position = state.position + 1;
        } else {
          throwError(state, "tag suffix cannot contain exclamation marks");
        }
      }
      ch = state.input.charCodeAt(++state.position);
    }
    tagName = state.input.slice(_position, state.position);
    if (PATTERN_FLOW_INDICATORS.test(tagName)) {
      throwError(state, "tag suffix cannot contain flow indicator characters");
    }
  }
  if (tagName && !PATTERN_TAG_URI.test(tagName)) {
    throwError(state, "tag name cannot contain such characters: " + tagName);
  }
  try {
    tagName = decodeURIComponent(tagName);
  } catch (err) {
    throwError(state, "tag name is malformed: " + tagName);
  }
  if (isVerbatim) {
    state.tag = tagName;
  } else if (_hasOwnProperty$1.call(state.tagMap, tagHandle)) {
    state.tag = state.tagMap[tagHandle] + tagName;
  } else if (tagHandle === "!") {
    state.tag = "!" + tagName;
  } else if (tagHandle === "!!") {
    state.tag = "tag:yaml.org,2002:" + tagName;
  } else {
    throwError(state, 'undeclared tag handle "' + tagHandle + '"');
  }
  return true;
}
function readAnchorProperty(state) {
  var _position, ch;
  ch = state.input.charCodeAt(state.position);
  if (ch !== 38)
    return false;
  if (state.anchor !== null) {
    throwError(state, "duplication of an anchor property");
  }
  ch = state.input.charCodeAt(++state.position);
  _position = state.position;
  while (ch !== 0 && !is_WS_OR_EOL(ch) && !is_FLOW_INDICATOR(ch)) {
    ch = state.input.charCodeAt(++state.position);
  }
  if (state.position === _position) {
    throwError(state, "name of an anchor node must contain at least one character");
  }
  state.anchor = state.input.slice(_position, state.position);
  return true;
}
function readAlias(state) {
  var _position, alias, ch;
  ch = state.input.charCodeAt(state.position);
  if (ch !== 42)
    return false;
  ch = state.input.charCodeAt(++state.position);
  _position = state.position;
  while (ch !== 0 && !is_WS_OR_EOL(ch) && !is_FLOW_INDICATOR(ch)) {
    ch = state.input.charCodeAt(++state.position);
  }
  if (state.position === _position) {
    throwError(state, "name of an alias node must contain at least one character");
  }
  alias = state.input.slice(_position, state.position);
  if (!_hasOwnProperty$1.call(state.anchorMap, alias)) {
    throwError(state, 'unidentified alias "' + alias + '"');
  }
  state.result = state.anchorMap[alias];
  skipSeparationSpace(state, true, -1);
  return true;
}
function composeNode(state, parentIndent, nodeContext, allowToSeek, allowCompact) {
  var allowBlockStyles, allowBlockScalars, allowBlockCollections, indentStatus = 1, atNewLine = false, hasContent = false, typeIndex, typeQuantity, typeList, type2, flowIndent, blockIndent;
  if (state.listener !== null) {
    state.listener("open", state);
  }
  state.tag = null;
  state.anchor = null;
  state.kind = null;
  state.result = null;
  allowBlockStyles = allowBlockScalars = allowBlockCollections = CONTEXT_BLOCK_OUT === nodeContext || CONTEXT_BLOCK_IN === nodeContext;
  if (allowToSeek) {
    if (skipSeparationSpace(state, true, -1)) {
      atNewLine = true;
      if (state.lineIndent > parentIndent) {
        indentStatus = 1;
      } else if (state.lineIndent === parentIndent) {
        indentStatus = 0;
      } else if (state.lineIndent < parentIndent) {
        indentStatus = -1;
      }
    }
  }
  if (indentStatus === 1) {
    while (readTagProperty(state) || readAnchorProperty(state)) {
      if (skipSeparationSpace(state, true, -1)) {
        atNewLine = true;
        allowBlockCollections = allowBlockStyles;
        if (state.lineIndent > parentIndent) {
          indentStatus = 1;
        } else if (state.lineIndent === parentIndent) {
          indentStatus = 0;
        } else if (state.lineIndent < parentIndent) {
          indentStatus = -1;
        }
      } else {
        allowBlockCollections = false;
      }
    }
  }
  if (allowBlockCollections) {
    allowBlockCollections = atNewLine || allowCompact;
  }
  if (indentStatus === 1 || CONTEXT_BLOCK_OUT === nodeContext) {
    if (CONTEXT_FLOW_IN === nodeContext || CONTEXT_FLOW_OUT === nodeContext) {
      flowIndent = parentIndent;
    } else {
      flowIndent = parentIndent + 1;
    }
    blockIndent = state.position - state.lineStart;
    if (indentStatus === 1) {
      if (allowBlockCollections && (readBlockSequence(state, blockIndent) || readBlockMapping(state, blockIndent, flowIndent)) || readFlowCollection(state, flowIndent)) {
        hasContent = true;
      } else {
        if (allowBlockScalars && readBlockScalar(state, flowIndent) || readSingleQuotedScalar(state, flowIndent) || readDoubleQuotedScalar(state, flowIndent)) {
          hasContent = true;
        } else if (readAlias(state)) {
          hasContent = true;
          if (state.tag !== null || state.anchor !== null) {
            throwError(state, "alias node should not have any properties");
          }
        } else if (readPlainScalar(state, flowIndent, CONTEXT_FLOW_IN === nodeContext)) {
          hasContent = true;
          if (state.tag === null) {
            state.tag = "?";
          }
        }
        if (state.anchor !== null) {
          state.anchorMap[state.anchor] = state.result;
        }
      }
    } else if (indentStatus === 0) {
      hasContent = allowBlockCollections && readBlockSequence(state, blockIndent);
    }
  }
  if (state.tag === null) {
    if (state.anchor !== null) {
      state.anchorMap[state.anchor] = state.result;
    }
  } else if (state.tag === "?") {
    if (state.result !== null && state.kind !== "scalar") {
      throwError(state, 'unacceptable node kind for !<?> tag; it should be "scalar", not "' + state.kind + '"');
    }
    for (typeIndex = 0, typeQuantity = state.implicitTypes.length;typeIndex < typeQuantity; typeIndex += 1) {
      type2 = state.implicitTypes[typeIndex];
      if (type2.resolve(state.result)) {
        state.result = type2.construct(state.result);
        state.tag = type2.tag;
        if (state.anchor !== null) {
          state.anchorMap[state.anchor] = state.result;
        }
        break;
      }
    }
  } else if (state.tag !== "!") {
    if (_hasOwnProperty$1.call(state.typeMap[state.kind || "fallback"], state.tag)) {
      type2 = state.typeMap[state.kind || "fallback"][state.tag];
    } else {
      type2 = null;
      typeList = state.typeMap.multi[state.kind || "fallback"];
      for (typeIndex = 0, typeQuantity = typeList.length;typeIndex < typeQuantity; typeIndex += 1) {
        if (state.tag.slice(0, typeList[typeIndex].tag.length) === typeList[typeIndex].tag) {
          type2 = typeList[typeIndex];
          break;
        }
      }
    }
    if (!type2) {
      throwError(state, "unknown tag !<" + state.tag + ">");
    }
    if (state.result !== null && type2.kind !== state.kind) {
      throwError(state, "unacceptable node kind for !<" + state.tag + '> tag; it should be "' + type2.kind + '", not "' + state.kind + '"');
    }
    if (!type2.resolve(state.result, state.tag)) {
      throwError(state, "cannot resolve a node with !<" + state.tag + "> explicit tag");
    } else {
      state.result = type2.construct(state.result, state.tag);
      if (state.anchor !== null) {
        state.anchorMap[state.anchor] = state.result;
      }
    }
  }
  if (state.listener !== null) {
    state.listener("close", state);
  }
  return state.tag !== null || state.anchor !== null || hasContent;
}
function readDocument(state) {
  var documentStart = state.position, _position, directiveName, directiveArgs, hasDirectives = false, ch;
  state.version = null;
  state.checkLineBreaks = state.legacy;
  state.tagMap = Object.create(null);
  state.anchorMap = Object.create(null);
  while ((ch = state.input.charCodeAt(state.position)) !== 0) {
    skipSeparationSpace(state, true, -1);
    ch = state.input.charCodeAt(state.position);
    if (state.lineIndent > 0 || ch !== 37) {
      break;
    }
    hasDirectives = true;
    ch = state.input.charCodeAt(++state.position);
    _position = state.position;
    while (ch !== 0 && !is_WS_OR_EOL(ch)) {
      ch = state.input.charCodeAt(++state.position);
    }
    directiveName = state.input.slice(_position, state.position);
    directiveArgs = [];
    if (directiveName.length < 1) {
      throwError(state, "directive name must not be less than one character in length");
    }
    while (ch !== 0) {
      while (is_WHITE_SPACE(ch)) {
        ch = state.input.charCodeAt(++state.position);
      }
      if (ch === 35) {
        do {
          ch = state.input.charCodeAt(++state.position);
        } while (ch !== 0 && !is_EOL(ch));
        break;
      }
      if (is_EOL(ch))
        break;
      _position = state.position;
      while (ch !== 0 && !is_WS_OR_EOL(ch)) {
        ch = state.input.charCodeAt(++state.position);
      }
      directiveArgs.push(state.input.slice(_position, state.position));
    }
    if (ch !== 0)
      readLineBreak(state);
    if (_hasOwnProperty$1.call(directiveHandlers, directiveName)) {
      directiveHandlers[directiveName](state, directiveName, directiveArgs);
    } else {
      throwWarning(state, 'unknown document directive "' + directiveName + '"');
    }
  }
  skipSeparationSpace(state, true, -1);
  if (state.lineIndent === 0 && state.input.charCodeAt(state.position) === 45 && state.input.charCodeAt(state.position + 1) === 45 && state.input.charCodeAt(state.position + 2) === 45) {
    state.position += 3;
    skipSeparationSpace(state, true, -1);
  } else if (hasDirectives) {
    throwError(state, "directives end mark is expected");
  }
  composeNode(state, state.lineIndent - 1, CONTEXT_BLOCK_OUT, false, true);
  skipSeparationSpace(state, true, -1);
  if (state.checkLineBreaks && PATTERN_NON_ASCII_LINE_BREAKS.test(state.input.slice(documentStart, state.position))) {
    throwWarning(state, "non-ASCII line breaks are interpreted as content");
  }
  state.documents.push(state.result);
  if (state.position === state.lineStart && testDocumentSeparator(state)) {
    if (state.input.charCodeAt(state.position) === 46) {
      state.position += 3;
      skipSeparationSpace(state, true, -1);
    }
    return;
  }
  if (state.position < state.length - 1) {
    throwError(state, "end of the stream or a document separator is expected");
  } else {
    return;
  }
}
function loadDocuments(input, options) {
  input = String(input);
  options = options || {};
  if (input.length !== 0) {
    if (input.charCodeAt(input.length - 1) !== 10 && input.charCodeAt(input.length - 1) !== 13) {
      input += `
`;
    }
    if (input.charCodeAt(0) === 65279) {
      input = input.slice(1);
    }
  }
  var state = new State$1(input, options);
  var nullpos = input.indexOf("\x00");
  if (nullpos !== -1) {
    state.position = nullpos;
    throwError(state, "null byte is not allowed in input");
  }
  state.input += "\x00";
  while (state.input.charCodeAt(state.position) === 32) {
    state.lineIndent += 1;
    state.position += 1;
  }
  while (state.position < state.length - 1) {
    readDocument(state);
  }
  return state.documents;
}
function loadAll$1(input, iterator, options) {
  if (iterator !== null && typeof iterator === "object" && typeof options === "undefined") {
    options = iterator;
    iterator = null;
  }
  var documents = loadDocuments(input, options);
  if (typeof iterator !== "function") {
    return documents;
  }
  for (var index = 0, length = documents.length;index < length; index += 1) {
    iterator(documents[index]);
  }
}
function load$1(input, options) {
  var documents = loadDocuments(input, options);
  if (documents.length === 0) {
    return;
  } else if (documents.length === 1) {
    return documents[0];
  }
  throw new exception("expected a single document in the stream, but found more");
}
var loadAll_1 = loadAll$1;
var load_1 = load$1;
var loader = {
  loadAll: loadAll_1,
  load: load_1
};
var _toString = Object.prototype.toString;
var _hasOwnProperty = Object.prototype.hasOwnProperty;
var CHAR_BOM = 65279;
var CHAR_TAB = 9;
var CHAR_LINE_FEED = 10;
var CHAR_CARRIAGE_RETURN = 13;
var CHAR_SPACE = 32;
var CHAR_EXCLAMATION = 33;
var CHAR_DOUBLE_QUOTE = 34;
var CHAR_SHARP = 35;
var CHAR_PERCENT = 37;
var CHAR_AMPERSAND = 38;
var CHAR_SINGLE_QUOTE = 39;
var CHAR_ASTERISK = 42;
var CHAR_COMMA = 44;
var CHAR_MINUS = 45;
var CHAR_COLON = 58;
var CHAR_EQUALS = 61;
var CHAR_GREATER_THAN = 62;
var CHAR_QUESTION = 63;
var CHAR_COMMERCIAL_AT = 64;
var CHAR_LEFT_SQUARE_BRACKET = 91;
var CHAR_RIGHT_SQUARE_BRACKET = 93;
var CHAR_GRAVE_ACCENT = 96;
var CHAR_LEFT_CURLY_BRACKET = 123;
var CHAR_VERTICAL_LINE = 124;
var CHAR_RIGHT_CURLY_BRACKET = 125;
var ESCAPE_SEQUENCES = {};
ESCAPE_SEQUENCES[0] = "\\0";
ESCAPE_SEQUENCES[7] = "\\a";
ESCAPE_SEQUENCES[8] = "\\b";
ESCAPE_SEQUENCES[9] = "\\t";
ESCAPE_SEQUENCES[10] = "\\n";
ESCAPE_SEQUENCES[11] = "\\v";
ESCAPE_SEQUENCES[12] = "\\f";
ESCAPE_SEQUENCES[13] = "\\r";
ESCAPE_SEQUENCES[27] = "\\e";
ESCAPE_SEQUENCES[34] = "\\\"";
ESCAPE_SEQUENCES[92] = "\\\\";
ESCAPE_SEQUENCES[133] = "\\N";
ESCAPE_SEQUENCES[160] = "\\_";
ESCAPE_SEQUENCES[8232] = "\\L";
ESCAPE_SEQUENCES[8233] = "\\P";
var DEPRECATED_BOOLEANS_SYNTAX = [
  "y",
  "Y",
  "yes",
  "Yes",
  "YES",
  "on",
  "On",
  "ON",
  "n",
  "N",
  "no",
  "No",
  "NO",
  "off",
  "Off",
  "OFF"
];
var DEPRECATED_BASE60_SYNTAX = /^[-+]?[0-9_]+(?::[0-9_]+)+(?:\.[0-9_]*)?$/;
function compileStyleMap(schema2, map2) {
  var result, keys, index, length, tag, style, type2;
  if (map2 === null)
    return {};
  result = {};
  keys = Object.keys(map2);
  for (index = 0, length = keys.length;index < length; index += 1) {
    tag = keys[index];
    style = String(map2[tag]);
    if (tag.slice(0, 2) === "!!") {
      tag = "tag:yaml.org,2002:" + tag.slice(2);
    }
    type2 = schema2.compiledTypeMap["fallback"][tag];
    if (type2 && _hasOwnProperty.call(type2.styleAliases, style)) {
      style = type2.styleAliases[style];
    }
    result[tag] = style;
  }
  return result;
}
function encodeHex(character) {
  var string, handle, length;
  string = character.toString(16).toUpperCase();
  if (character <= 255) {
    handle = "x";
    length = 2;
  } else if (character <= 65535) {
    handle = "u";
    length = 4;
  } else if (character <= 4294967295) {
    handle = "U";
    length = 8;
  } else {
    throw new exception("code point within a string may not be greater than 0xFFFFFFFF");
  }
  return "\\" + handle + common.repeat("0", length - string.length) + string;
}
var QUOTING_TYPE_SINGLE = 1;
var QUOTING_TYPE_DOUBLE = 2;
function State(options) {
  this.schema = options["schema"] || _default;
  this.indent = Math.max(1, options["indent"] || 2);
  this.noArrayIndent = options["noArrayIndent"] || false;
  this.skipInvalid = options["skipInvalid"] || false;
  this.flowLevel = common.isNothing(options["flowLevel"]) ? -1 : options["flowLevel"];
  this.styleMap = compileStyleMap(this.schema, options["styles"] || null);
  this.sortKeys = options["sortKeys"] || false;
  this.lineWidth = options["lineWidth"] || 80;
  this.noRefs = options["noRefs"] || false;
  this.noCompatMode = options["noCompatMode"] || false;
  this.condenseFlow = options["condenseFlow"] || false;
  this.quotingType = options["quotingType"] === '"' ? QUOTING_TYPE_DOUBLE : QUOTING_TYPE_SINGLE;
  this.forceQuotes = options["forceQuotes"] || false;
  this.replacer = typeof options["replacer"] === "function" ? options["replacer"] : null;
  this.implicitTypes = this.schema.compiledImplicit;
  this.explicitTypes = this.schema.compiledExplicit;
  this.tag = null;
  this.result = "";
  this.duplicates = [];
  this.usedDuplicates = null;
}
function indentString(string, spaces) {
  var ind = common.repeat(" ", spaces), position = 0, next = -1, result = "", line, length = string.length;
  while (position < length) {
    next = string.indexOf(`
`, position);
    if (next === -1) {
      line = string.slice(position);
      position = length;
    } else {
      line = string.slice(position, next + 1);
      position = next + 1;
    }
    if (line.length && line !== `
`)
      result += ind;
    result += line;
  }
  return result;
}
function generateNextLine(state, level) {
  return `
` + common.repeat(" ", state.indent * level);
}
function testImplicitResolving(state, str2) {
  var index, length, type2;
  for (index = 0, length = state.implicitTypes.length;index < length; index += 1) {
    type2 = state.implicitTypes[index];
    if (type2.resolve(str2)) {
      return true;
    }
  }
  return false;
}
function isWhitespace(c) {
  return c === CHAR_SPACE || c === CHAR_TAB;
}
function isPrintable(c) {
  return 32 <= c && c <= 126 || 161 <= c && c <= 55295 && c !== 8232 && c !== 8233 || 57344 <= c && c <= 65533 && c !== CHAR_BOM || 65536 <= c && c <= 1114111;
}
function isNsCharOrWhitespace(c) {
  return isPrintable(c) && c !== CHAR_BOM && c !== CHAR_CARRIAGE_RETURN && c !== CHAR_LINE_FEED;
}
function isPlainSafe(c, prev, inblock) {
  var cIsNsCharOrWhitespace = isNsCharOrWhitespace(c);
  var cIsNsChar = cIsNsCharOrWhitespace && !isWhitespace(c);
  return (inblock ? cIsNsCharOrWhitespace : cIsNsCharOrWhitespace && c !== CHAR_COMMA && c !== CHAR_LEFT_SQUARE_BRACKET && c !== CHAR_RIGHT_SQUARE_BRACKET && c !== CHAR_LEFT_CURLY_BRACKET && c !== CHAR_RIGHT_CURLY_BRACKET) && c !== CHAR_SHARP && !(prev === CHAR_COLON && !cIsNsChar) || isNsCharOrWhitespace(prev) && !isWhitespace(prev) && c === CHAR_SHARP || prev === CHAR_COLON && cIsNsChar;
}
function isPlainSafeFirst(c) {
  return isPrintable(c) && c !== CHAR_BOM && !isWhitespace(c) && c !== CHAR_MINUS && c !== CHAR_QUESTION && c !== CHAR_COLON && c !== CHAR_COMMA && c !== CHAR_LEFT_SQUARE_BRACKET && c !== CHAR_RIGHT_SQUARE_BRACKET && c !== CHAR_LEFT_CURLY_BRACKET && c !== CHAR_RIGHT_CURLY_BRACKET && c !== CHAR_SHARP && c !== CHAR_AMPERSAND && c !== CHAR_ASTERISK && c !== CHAR_EXCLAMATION && c !== CHAR_VERTICAL_LINE && c !== CHAR_EQUALS && c !== CHAR_GREATER_THAN && c !== CHAR_SINGLE_QUOTE && c !== CHAR_DOUBLE_QUOTE && c !== CHAR_PERCENT && c !== CHAR_COMMERCIAL_AT && c !== CHAR_GRAVE_ACCENT;
}
function isPlainSafeLast(c) {
  return !isWhitespace(c) && c !== CHAR_COLON;
}
function codePointAt(string, pos) {
  var first = string.charCodeAt(pos), second;
  if (first >= 55296 && first <= 56319 && pos + 1 < string.length) {
    second = string.charCodeAt(pos + 1);
    if (second >= 56320 && second <= 57343) {
      return (first - 55296) * 1024 + second - 56320 + 65536;
    }
  }
  return first;
}
function needIndentIndicator(string) {
  var leadingSpaceRe = /^\n* /;
  return leadingSpaceRe.test(string);
}
var STYLE_PLAIN = 1;
var STYLE_SINGLE = 2;
var STYLE_LITERAL = 3;
var STYLE_FOLDED = 4;
var STYLE_DOUBLE = 5;
function chooseScalarStyle(string, singleLineOnly, indentPerLevel, lineWidth, testAmbiguousType, quotingType, forceQuotes, inblock) {
  var i2;
  var char = 0;
  var prevChar = null;
  var hasLineBreak = false;
  var hasFoldableLine = false;
  var shouldTrackWidth = lineWidth !== -1;
  var previousLineBreak = -1;
  var plain = isPlainSafeFirst(codePointAt(string, 0)) && isPlainSafeLast(codePointAt(string, string.length - 1));
  if (singleLineOnly || forceQuotes) {
    for (i2 = 0;i2 < string.length; char >= 65536 ? i2 += 2 : i2++) {
      char = codePointAt(string, i2);
      if (!isPrintable(char)) {
        return STYLE_DOUBLE;
      }
      plain = plain && isPlainSafe(char, prevChar, inblock);
      prevChar = char;
    }
  } else {
    for (i2 = 0;i2 < string.length; char >= 65536 ? i2 += 2 : i2++) {
      char = codePointAt(string, i2);
      if (char === CHAR_LINE_FEED) {
        hasLineBreak = true;
        if (shouldTrackWidth) {
          hasFoldableLine = hasFoldableLine || i2 - previousLineBreak - 1 > lineWidth && string[previousLineBreak + 1] !== " ";
          previousLineBreak = i2;
        }
      } else if (!isPrintable(char)) {
        return STYLE_DOUBLE;
      }
      plain = plain && isPlainSafe(char, prevChar, inblock);
      prevChar = char;
    }
    hasFoldableLine = hasFoldableLine || shouldTrackWidth && (i2 - previousLineBreak - 1 > lineWidth && string[previousLineBreak + 1] !== " ");
  }
  if (!hasLineBreak && !hasFoldableLine) {
    if (plain && !forceQuotes && !testAmbiguousType(string)) {
      return STYLE_PLAIN;
    }
    return quotingType === QUOTING_TYPE_DOUBLE ? STYLE_DOUBLE : STYLE_SINGLE;
  }
  if (indentPerLevel > 9 && needIndentIndicator(string)) {
    return STYLE_DOUBLE;
  }
  if (!forceQuotes) {
    return hasFoldableLine ? STYLE_FOLDED : STYLE_LITERAL;
  }
  return quotingType === QUOTING_TYPE_DOUBLE ? STYLE_DOUBLE : STYLE_SINGLE;
}
function writeScalar(state, string, level, iskey, inblock) {
  state.dump = function() {
    if (string.length === 0) {
      return state.quotingType === QUOTING_TYPE_DOUBLE ? '""' : "''";
    }
    if (!state.noCompatMode) {
      if (DEPRECATED_BOOLEANS_SYNTAX.indexOf(string) !== -1 || DEPRECATED_BASE60_SYNTAX.test(string)) {
        return state.quotingType === QUOTING_TYPE_DOUBLE ? '"' + string + '"' : "'" + string + "'";
      }
    }
    var indent = state.indent * Math.max(1, level);
    var lineWidth = state.lineWidth === -1 ? -1 : Math.max(Math.min(state.lineWidth, 40), state.lineWidth - indent);
    var singleLineOnly = iskey || state.flowLevel > -1 && level >= state.flowLevel;
    function testAmbiguity(string2) {
      return testImplicitResolving(state, string2);
    }
    switch (chooseScalarStyle(string, singleLineOnly, state.indent, lineWidth, testAmbiguity, state.quotingType, state.forceQuotes && !iskey, inblock)) {
      case STYLE_PLAIN:
        return string;
      case STYLE_SINGLE:
        return "'" + string.replace(/'/g, "''") + "'";
      case STYLE_LITERAL:
        return "|" + blockHeader(string, state.indent) + dropEndingNewline(indentString(string, indent));
      case STYLE_FOLDED:
        return ">" + blockHeader(string, state.indent) + dropEndingNewline(indentString(foldString(string, lineWidth), indent));
      case STYLE_DOUBLE:
        return '"' + escapeString(string) + '"';
      default:
        throw new exception("impossible error: invalid scalar style");
    }
  }();
}
function blockHeader(string, indentPerLevel) {
  var indentIndicator = needIndentIndicator(string) ? String(indentPerLevel) : "";
  var clip = string[string.length - 1] === `
`;
  var keep = clip && (string[string.length - 2] === `
` || string === `
`);
  var chomp = keep ? "+" : clip ? "" : "-";
  return indentIndicator + chomp + `
`;
}
function dropEndingNewline(string) {
  return string[string.length - 1] === `
` ? string.slice(0, -1) : string;
}
function foldString(string, width) {
  var lineRe = /(\n+)([^\n]*)/g;
  var result = function() {
    var nextLF = string.indexOf(`
`);
    nextLF = nextLF !== -1 ? nextLF : string.length;
    lineRe.lastIndex = nextLF;
    return foldLine(string.slice(0, nextLF), width);
  }();
  var prevMoreIndented = string[0] === `
` || string[0] === " ";
  var moreIndented;
  var match;
  while (match = lineRe.exec(string)) {
    var prefix = match[1], line = match[2];
    moreIndented = line[0] === " ";
    result += prefix + (!prevMoreIndented && !moreIndented && line !== "" ? `
` : "") + foldLine(line, width);
    prevMoreIndented = moreIndented;
  }
  return result;
}
function foldLine(line, width) {
  if (line === "" || line[0] === " ")
    return line;
  var breakRe = / [^ ]/g;
  var match;
  var start = 0, end, curr = 0, next = 0;
  var result = "";
  while (match = breakRe.exec(line)) {
    next = match.index;
    if (next - start > width) {
      end = curr > start ? curr : next;
      result += `
` + line.slice(start, end);
      start = end + 1;
    }
    curr = next;
  }
  result += `
`;
  if (line.length - start > width && curr > start) {
    result += line.slice(start, curr) + `
` + line.slice(curr + 1);
  } else {
    result += line.slice(start);
  }
  return result.slice(1);
}
function escapeString(string) {
  var result = "";
  var char = 0;
  var escapeSeq;
  for (var i2 = 0;i2 < string.length; char >= 65536 ? i2 += 2 : i2++) {
    char = codePointAt(string, i2);
    escapeSeq = ESCAPE_SEQUENCES[char];
    if (!escapeSeq && isPrintable(char)) {
      result += string[i2];
      if (char >= 65536)
        result += string[i2 + 1];
    } else {
      result += escapeSeq || encodeHex(char);
    }
  }
  return result;
}
function writeFlowSequence(state, level, object) {
  var _result = "", _tag = state.tag, index, length, value;
  for (index = 0, length = object.length;index < length; index += 1) {
    value = object[index];
    if (state.replacer) {
      value = state.replacer.call(object, String(index), value);
    }
    if (writeNode(state, level, value, false, false) || typeof value === "undefined" && writeNode(state, level, null, false, false)) {
      if (_result !== "")
        _result += "," + (!state.condenseFlow ? " " : "");
      _result += state.dump;
    }
  }
  state.tag = _tag;
  state.dump = "[" + _result + "]";
}
function writeBlockSequence(state, level, object, compact) {
  var _result = "", _tag = state.tag, index, length, value;
  for (index = 0, length = object.length;index < length; index += 1) {
    value = object[index];
    if (state.replacer) {
      value = state.replacer.call(object, String(index), value);
    }
    if (writeNode(state, level + 1, value, true, true, false, true) || typeof value === "undefined" && writeNode(state, level + 1, null, true, true, false, true)) {
      if (!compact || _result !== "") {
        _result += generateNextLine(state, level);
      }
      if (state.dump && CHAR_LINE_FEED === state.dump.charCodeAt(0)) {
        _result += "-";
      } else {
        _result += "- ";
      }
      _result += state.dump;
    }
  }
  state.tag = _tag;
  state.dump = _result || "[]";
}
function writeFlowMapping(state, level, object) {
  var _result = "", _tag = state.tag, objectKeyList = Object.keys(object), index, length, objectKey, objectValue, pairBuffer;
  for (index = 0, length = objectKeyList.length;index < length; index += 1) {
    pairBuffer = "";
    if (_result !== "")
      pairBuffer += ", ";
    if (state.condenseFlow)
      pairBuffer += '"';
    objectKey = objectKeyList[index];
    objectValue = object[objectKey];
    if (state.replacer) {
      objectValue = state.replacer.call(object, objectKey, objectValue);
    }
    if (!writeNode(state, level, objectKey, false, false)) {
      continue;
    }
    if (state.dump.length > 1024)
      pairBuffer += "? ";
    pairBuffer += state.dump + (state.condenseFlow ? '"' : "") + ":" + (state.condenseFlow ? "" : " ");
    if (!writeNode(state, level, objectValue, false, false)) {
      continue;
    }
    pairBuffer += state.dump;
    _result += pairBuffer;
  }
  state.tag = _tag;
  state.dump = "{" + _result + "}";
}
function writeBlockMapping(state, level, object, compact) {
  var _result = "", _tag = state.tag, objectKeyList = Object.keys(object), index, length, objectKey, objectValue, explicitPair, pairBuffer;
  if (state.sortKeys === true) {
    objectKeyList.sort();
  } else if (typeof state.sortKeys === "function") {
    objectKeyList.sort(state.sortKeys);
  } else if (state.sortKeys) {
    throw new exception("sortKeys must be a boolean or a function");
  }
  for (index = 0, length = objectKeyList.length;index < length; index += 1) {
    pairBuffer = "";
    if (!compact || _result !== "") {
      pairBuffer += generateNextLine(state, level);
    }
    objectKey = objectKeyList[index];
    objectValue = object[objectKey];
    if (state.replacer) {
      objectValue = state.replacer.call(object, objectKey, objectValue);
    }
    if (!writeNode(state, level + 1, objectKey, true, true, true)) {
      continue;
    }
    explicitPair = state.tag !== null && state.tag !== "?" || state.dump && state.dump.length > 1024;
    if (explicitPair) {
      if (state.dump && CHAR_LINE_FEED === state.dump.charCodeAt(0)) {
        pairBuffer += "?";
      } else {
        pairBuffer += "? ";
      }
    }
    pairBuffer += state.dump;
    if (explicitPair) {
      pairBuffer += generateNextLine(state, level);
    }
    if (!writeNode(state, level + 1, objectValue, true, explicitPair)) {
      continue;
    }
    if (state.dump && CHAR_LINE_FEED === state.dump.charCodeAt(0)) {
      pairBuffer += ":";
    } else {
      pairBuffer += ": ";
    }
    pairBuffer += state.dump;
    _result += pairBuffer;
  }
  state.tag = _tag;
  state.dump = _result || "{}";
}
function detectType(state, object, explicit) {
  var _result, typeList, index, length, type2, style;
  typeList = explicit ? state.explicitTypes : state.implicitTypes;
  for (index = 0, length = typeList.length;index < length; index += 1) {
    type2 = typeList[index];
    if ((type2.instanceOf || type2.predicate) && (!type2.instanceOf || typeof object === "object" && object instanceof type2.instanceOf) && (!type2.predicate || type2.predicate(object))) {
      if (explicit) {
        if (type2.multi && type2.representName) {
          state.tag = type2.representName(object);
        } else {
          state.tag = type2.tag;
        }
      } else {
        state.tag = "?";
      }
      if (type2.represent) {
        style = state.styleMap[type2.tag] || type2.defaultStyle;
        if (_toString.call(type2.represent) === "[object Function]") {
          _result = type2.represent(object, style);
        } else if (_hasOwnProperty.call(type2.represent, style)) {
          _result = type2.represent[style](object, style);
        } else {
          throw new exception("!<" + type2.tag + '> tag resolver accepts not "' + style + '" style');
        }
        state.dump = _result;
      }
      return true;
    }
  }
  return false;
}
function writeNode(state, level, object, block, compact, iskey, isblockseq) {
  state.tag = null;
  state.dump = object;
  if (!detectType(state, object, false)) {
    detectType(state, object, true);
  }
  var type2 = _toString.call(state.dump);
  var inblock = block;
  var tagStr;
  if (block) {
    block = state.flowLevel < 0 || state.flowLevel > level;
  }
  var objectOrArray = type2 === "[object Object]" || type2 === "[object Array]", duplicateIndex, duplicate;
  if (objectOrArray) {
    duplicateIndex = state.duplicates.indexOf(object);
    duplicate = duplicateIndex !== -1;
  }
  if (state.tag !== null && state.tag !== "?" || duplicate || state.indent !== 2 && level > 0) {
    compact = false;
  }
  if (duplicate && state.usedDuplicates[duplicateIndex]) {
    state.dump = "*ref_" + duplicateIndex;
  } else {
    if (objectOrArray && duplicate && !state.usedDuplicates[duplicateIndex]) {
      state.usedDuplicates[duplicateIndex] = true;
    }
    if (type2 === "[object Object]") {
      if (block && Object.keys(state.dump).length !== 0) {
        writeBlockMapping(state, level, state.dump, compact);
        if (duplicate) {
          state.dump = "&ref_" + duplicateIndex + state.dump;
        }
      } else {
        writeFlowMapping(state, level, state.dump);
        if (duplicate) {
          state.dump = "&ref_" + duplicateIndex + " " + state.dump;
        }
      }
    } else if (type2 === "[object Array]") {
      if (block && state.dump.length !== 0) {
        if (state.noArrayIndent && !isblockseq && level > 0) {
          writeBlockSequence(state, level - 1, state.dump, compact);
        } else {
          writeBlockSequence(state, level, state.dump, compact);
        }
        if (duplicate) {
          state.dump = "&ref_" + duplicateIndex + state.dump;
        }
      } else {
        writeFlowSequence(state, level, state.dump);
        if (duplicate) {
          state.dump = "&ref_" + duplicateIndex + " " + state.dump;
        }
      }
    } else if (type2 === "[object String]") {
      if (state.tag !== "?") {
        writeScalar(state, state.dump, level, iskey, inblock);
      }
    } else if (type2 === "[object Undefined]") {
      return false;
    } else {
      if (state.skipInvalid)
        return false;
      throw new exception("unacceptable kind of an object to dump " + type2);
    }
    if (state.tag !== null && state.tag !== "?") {
      tagStr = encodeURI(state.tag[0] === "!" ? state.tag.slice(1) : state.tag).replace(/!/g, "%21");
      if (state.tag[0] === "!") {
        tagStr = "!" + tagStr;
      } else if (tagStr.slice(0, 18) === "tag:yaml.org,2002:") {
        tagStr = "!!" + tagStr.slice(18);
      } else {
        tagStr = "!<" + tagStr + ">";
      }
      state.dump = tagStr + " " + state.dump;
    }
  }
  return true;
}
function getDuplicateReferences(object, state) {
  var objects = [], duplicatesIndexes = [], index, length;
  inspectNode(object, objects, duplicatesIndexes);
  for (index = 0, length = duplicatesIndexes.length;index < length; index += 1) {
    state.duplicates.push(objects[duplicatesIndexes[index]]);
  }
  state.usedDuplicates = new Array(length);
}
function inspectNode(object, objects, duplicatesIndexes) {
  var objectKeyList, index, length;
  if (object !== null && typeof object === "object") {
    index = objects.indexOf(object);
    if (index !== -1) {
      if (duplicatesIndexes.indexOf(index) === -1) {
        duplicatesIndexes.push(index);
      }
    } else {
      objects.push(object);
      if (Array.isArray(object)) {
        for (index = 0, length = object.length;index < length; index += 1) {
          inspectNode(object[index], objects, duplicatesIndexes);
        }
      } else {
        objectKeyList = Object.keys(object);
        for (index = 0, length = objectKeyList.length;index < length; index += 1) {
          inspectNode(object[objectKeyList[index]], objects, duplicatesIndexes);
        }
      }
    }
  }
}
function dump$1(input, options) {
  options = options || {};
  var state = new State(options);
  if (!state.noRefs)
    getDuplicateReferences(input, state);
  var value = input;
  if (state.replacer) {
    value = state.replacer.call({ "": value }, "", value);
  }
  if (writeNode(state, 0, value, true, true))
    return state.dump + `
`;
  return "";
}
var dump_1 = dump$1;
var dumper = {
  dump: dump_1
};
function renamed(from, to) {
  return function() {
    throw new Error("Function yaml." + from + " is removed in js-yaml 4. " + "Use yaml." + to + " instead, which is now safe by default.");
  };
}
var Type = type;
var Schema = schema;
var FAILSAFE_SCHEMA = failsafe;
var JSON_SCHEMA = json;
var CORE_SCHEMA = core;
var DEFAULT_SCHEMA = _default;
var load = loader.load;
var loadAll = loader.loadAll;
var dump = dumper.dump;
var YAMLException = exception;
var types = {
  binary,
  float,
  map,
  null: _null,
  pairs,
  set,
  timestamp,
  bool,
  int,
  merge,
  omap,
  seq,
  str
};
var safeLoad = renamed("safeLoad", "load");
var safeLoadAll = renamed("safeLoadAll", "loadAll");
var safeDump = renamed("safeDump", "dump");
var jsYaml = {
  Type,
  Schema,
  FAILSAFE_SCHEMA,
  JSON_SCHEMA,
  CORE_SCHEMA,
  DEFAULT_SCHEMA,
  load,
  loadAll,
  dump,
  YAMLException,
  types,
  safeLoad,
  safeLoadAll,
  safeDump
};

// src/config/agent-loader.ts
import { homedir } from "os";
import { basename, extname, isAbsolute, join, relative, resolve } from "path";
var MODEL_KEY_RE = /^[a-zA-Z0-9_-]{1,100}\/[a-zA-Z0-9._-]{1,100}$/;
function isPathInside(baseDir, targetPath) {
  const rel = relative(baseDir, targetPath);
  return rel === "" || !rel.startsWith("..") && !isAbsolute(rel);
}
function toRelativeAgentPath(absPath, projectDirectory, homeDir = homedir()) {
  const resolvedAbs = resolve(absPath);
  const configBase = resolve(join(homeDir, ".config", "opencode"));
  const projectBase = resolve(projectDirectory);
  if (isPathInside(configBase, resolvedAbs)) {
    const rel = relative(configBase, resolvedAbs);
    if (rel)
      return rel;
  }
  if (isPathInside(projectBase, resolvedAbs)) {
    const rel = relative(projectBase, resolvedAbs);
    if (rel)
      return rel;
  }
  return basename(absPath);
}
function stemName(filePath) {
  const base = basename(filePath);
  const ext = extname(base);
  return ext ? base.slice(0, -ext.length) : base;
}
function collectFiles(dir, recursive) {
  if (!existsSync(dir))
    return [];
  const baseDir = resolve(dir);
  let baseRealPath = baseDir;
  try {
    baseRealPath = realpathSync(baseDir);
  } catch {
    return [];
  }
  try {
    let entries;
    if (recursive) {
      entries = readdirSync(baseDir, { recursive: true });
    } else {
      entries = readdirSync(baseDir);
    }
    return entries.filter((e) => e.endsWith(".md") || e.endsWith(".json")).map((e) => {
      const candidatePath = resolve(join(baseDir, e));
      if (!isPathInside(baseDir, candidatePath))
        return null;
      try {
        const realPath = realpathSync(candidatePath);
        if (!isPathInside(baseRealPath, realPath))
          return null;
        if (!statSync(realPath).isFile())
          return null;
        return realPath;
      } catch {
        return null;
      }
    }).filter((path) => path !== null);
  } catch {
    return [];
  }
}
function parseFrontmatter(content) {
  if (!content.startsWith("---"))
    return null;
  const end = content.indexOf(`
---`, 3);
  if (end === -1)
    return null;
  const frontmatter = content.slice(3, end).trim();
  try {
    return jsYaml.load(frontmatter, { schema: jsYaml.CORE_SCHEMA });
  } catch {
    return null;
  }
}
function parseAgentFile(filePath) {
  try {
    const content = readFileSync(filePath, "utf-8");
    let data;
    if (filePath.endsWith(".json")) {
      data = JSON.parse(content);
    } else {
      data = parseFrontmatter(content);
    }
    if (!data || typeof data !== "object" || Array.isArray(data))
      return null;
    const obj = data;
    const fallback = obj.fallback;
    if (!fallback || typeof fallback !== "object" || Array.isArray(fallback))
      return null;
    const models = fallback.models;
    if (!Array.isArray(models) || models.length === 0)
      return null;
    const validModels = [];
    for (const m of models) {
      if (typeof m !== "string" || !MODEL_KEY_RE.test(m)) {
        console.warn(`[model-fallback] agent-loader: skipping invalid model key ${JSON.stringify(m)} in ${basename(filePath)}`);
        continue;
      }
      validModels.push(m);
    }
    if (validModels.length === 0)
      return null;
    const name = typeof obj.name === "string" && obj.name.length > 0 ? obj.name : stemName(filePath);
    return { name, config: { fallbackModels: validModels } };
  } catch (err) {
    console.warn(`[model-fallback] agent-loader: failed to parse ${basename(filePath)}:`, err);
    return null;
  }
}
function resolveAgentFile(agentName, projectDirectory, customDirs, homeDir = homedir()) {
  const scanDirs = customDirs && customDirs.length > 0 ? customDirs.map((d) => [d, false]) : [
    [join(homeDir, ".config", "opencode", "agents"), false],
    [join(homeDir, ".config", "opencode", "agent"), true],
    [join(projectDirectory, ".opencode", "agents"), false],
    [join(projectDirectory, ".opencode", "agent"), true]
  ];
  const allFiles = [];
  for (const [dir, recursive] of scanDirs) {
    allFiles.push(...collectFiles(dir, recursive));
  }
  for (const file of allFiles) {
    if (stemName(file) === agentName)
      return file;
  }
  for (const file of allFiles) {
    try {
      const content = readFileSync(file, "utf-8");
      const data = file.endsWith(".json") ? JSON.parse(content) : parseFrontmatter(content);
      if (data && typeof data === "object" && !Array.isArray(data) && data.name === agentName) {
        return file;
      }
    } catch {}
  }
  return null;
}
function loadAgentFallbackConfigs(projectDirectory, homeDir = homedir()) {
  const scanDirs = [
    [join(homeDir, ".config", "opencode", "agents"), false],
    [join(homeDir, ".config", "opencode", "agent"), true],
    [join(projectDirectory, ".opencode", "agents"), false],
    [join(projectDirectory, ".opencode", "agent"), true]
  ];
  const result = {};
  for (const [dir, recursive] of scanDirs) {
    const files = collectFiles(dir, recursive);
    for (const file of files) {
      const parsed = parseAgentFile(file);
      if (parsed) {
        result[parsed.name] = parsed.config;
      }
    }
  }
  return result;
}

// src/config/loader.ts
import { existsSync as existsSync2, readFileSync as readFileSync2 } from "fs";
import { homedir as homedir4 } from "os";
import { basename as basename2, join as join3 } from "path";

// src/config/defaults.ts
import { homedir as homedir2 } from "os";
import { join as join2 } from "path";
var DEFAULT_PATTERNS = [
  "rate limit",
  "ratelimit",
  "usage limit",
  "too many requests",
  "quota exceeded",
  "overloaded",
  "capacity exceeded",
  "credits exhausted",
  "insufficient credit",
  "billing limit",
  "resource exhausted",
  "stream error",
  "429"
];
var DEFAULT_LOG_PATH = join2(homedir2(), ".local/share/opencode/logs/model-fallback.log");
var DEFAULT_CONFIG = {
  enabled: true,
  defaults: {
    fallbackOn: ["rate_limit", "quota_exceeded", "5xx", "timeout", "overloaded"],
    cooldownMs: 300000,
    retryOriginalAfterMs: 900000,
    maxFallbackDepth: 3
  },
  agents: {
    "*": {
      fallbackModels: []
    }
  },
  patterns: DEFAULT_PATTERNS,
  logging: true,
  logLevel: "info",
  logPath: DEFAULT_LOG_PATH,
  agentDirs: []
};

// src/config/migrate.ts
function isOldFormat(raw) {
  if (typeof raw !== "object" || raw === null)
    return false;
  return "fallbackModel" in raw && typeof raw.fallbackModel === "string";
}
function migrateOldConfig(old) {
  const migrated = {};
  if (typeof old.enabled === "boolean")
    migrated.enabled = old.enabled;
  if (typeof old.logging === "boolean")
    migrated.logging = old.logging;
  if (Array.isArray(old.patterns))
    migrated.patterns = old.patterns;
  if (old.fallbackModel) {
    migrated.agents = {
      "*": { fallbackModels: [old.fallbackModel] }
    };
  }
  if (typeof old.cooldownMs === "number") {
    migrated.defaults = { cooldownMs: old.cooldownMs };
  }
  return migrated;
}

// src/config/schema.ts
import { homedir as homedir3 } from "os";
import { isAbsolute as isAbsolute2, relative as relative2, resolve as resolve2 } from "path";
import { z } from "zod";
var MODEL_KEY_RE2 = /^[a-zA-Z0-9_-]{1,100}\/[a-zA-Z0-9._-]{1,100}$/;
var home = resolve2(homedir3());
function formatPath(path) {
  return path.map((segment) => String(segment)).join(".");
}
function normalizeLogPath(path) {
  if (path.startsWith("~/")) {
    return resolve2(home, path.slice(2));
  }
  return resolve2(path);
}
function isPathWithinHome(path) {
  const rel = relative2(home, path);
  return rel === "" || !rel.startsWith("..") && !isAbsolute2(rel);
}
var modelKey = z.string().regex(MODEL_KEY_RE2, "Model key must be 'providerID/modelID'");
var agentConfig = z.object({
  fallbackModels: z.array(modelKey).min(1),
  models: z.array(modelKey).min(1).optional()
});
var fallbackDefaults = z.object({
  fallbackOn: z.array(z.enum(["rate_limit", "quota_exceeded", "5xx", "timeout", "overloaded"])).optional(),
  cooldownMs: z.number().min(1e4).optional(),
  retryOriginalAfterMs: z.number().min(1e4).optional(),
  maxFallbackDepth: z.number().int().min(1).max(10).optional()
});
var logPathSchema = z.string().refine((p) => isPathWithinHome(normalizeLogPath(p)), "logPath must resolve within $HOME");
var pluginConfigSchema = z.object({
  enabled: z.boolean().optional(),
  defaults: fallbackDefaults.optional(),
  agents: z.record(z.string(), agentConfig).optional(),
  patterns: z.array(z.string()).optional(),
  logging: z.boolean().optional(),
  logLevel: z.enum(["debug", "info"]).optional(),
  logPath: logPathSchema.optional(),
  agentDirs: z.array(z.string()).optional()
}).strict();
function parseConfig(raw) {
  const warnings = [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    warnings.push("Config warning at root: expected object — using default");
    return { config: {}, warnings };
  }
  const obj = raw;
  const allowed = new Set([
    "enabled",
    "defaults",
    "agents",
    "patterns",
    "logging",
    "logLevel",
    "logPath",
    "agentDirs"
  ]);
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) {
      warnings.push(`Config warning at ${key}: unknown field — using default`);
    }
  }
  const config = {};
  const enabledResult = z.boolean().safeParse(obj.enabled);
  if (obj.enabled !== undefined) {
    if (enabledResult.success) {
      config.enabled = enabledResult.data;
    } else {
      warnings.push(`Config warning at enabled: ${enabledResult.error.issues[0].message} — using default`);
    }
  }
  if (obj.defaults !== undefined) {
    if (!obj.defaults || typeof obj.defaults !== "object" || Array.isArray(obj.defaults)) {
      warnings.push("Config warning at defaults: expected object — using default");
    } else {
      const defaultsObj = obj.defaults;
      const parsedDefaults = {};
      const fallbackOnResult = fallbackDefaults.shape.fallbackOn.safeParse(defaultsObj.fallbackOn);
      if (defaultsObj.fallbackOn !== undefined) {
        if (fallbackOnResult.success && fallbackOnResult.data !== undefined) {
          parsedDefaults.fallbackOn = fallbackOnResult.data;
        } else if (!fallbackOnResult.success) {
          for (const issue of fallbackOnResult.error.issues) {
            const suffix = issue.path.length > 0 ? `.${formatPath(issue.path)}` : "";
            warnings.push(`Config warning at defaults.fallbackOn${suffix}: ${issue.message} — using default`);
          }
        }
      }
      const cooldownResult = fallbackDefaults.shape.cooldownMs.safeParse(defaultsObj.cooldownMs);
      if (defaultsObj.cooldownMs !== undefined) {
        if (cooldownResult.success && cooldownResult.data !== undefined) {
          parsedDefaults.cooldownMs = cooldownResult.data;
        } else if (!cooldownResult.success) {
          for (const issue of cooldownResult.error.issues) {
            const suffix = issue.path.length > 0 ? `.${formatPath(issue.path)}` : "";
            warnings.push(`Config warning at defaults.cooldownMs${suffix}: ${issue.message} — using default`);
          }
        }
      }
      const retryResult = fallbackDefaults.shape.retryOriginalAfterMs.safeParse(defaultsObj.retryOriginalAfterMs);
      if (defaultsObj.retryOriginalAfterMs !== undefined) {
        if (retryResult.success && retryResult.data !== undefined) {
          parsedDefaults.retryOriginalAfterMs = retryResult.data;
        } else if (!retryResult.success) {
          for (const issue of retryResult.error.issues) {
            const suffix = issue.path.length > 0 ? `.${formatPath(issue.path)}` : "";
            warnings.push(`Config warning at defaults.retryOriginalAfterMs${suffix}: ${issue.message} — using default`);
          }
        }
      }
      const depthResult = fallbackDefaults.shape.maxFallbackDepth.safeParse(defaultsObj.maxFallbackDepth);
      if (defaultsObj.maxFallbackDepth !== undefined) {
        if (depthResult.success && depthResult.data !== undefined) {
          parsedDefaults.maxFallbackDepth = depthResult.data;
        } else if (!depthResult.success) {
          for (const issue of depthResult.error.issues) {
            const suffix = issue.path.length > 0 ? `.${formatPath(issue.path)}` : "";
            warnings.push(`Config warning at defaults.maxFallbackDepth${suffix}: ${issue.message} — using default`);
          }
        }
      }
      for (const key of Object.keys(defaultsObj)) {
        if (!Object.hasOwn(fallbackDefaults.shape, key)) {
          warnings.push(`Config warning at defaults.${key}: unknown field — using default`);
        }
      }
      if (Object.keys(parsedDefaults).length > 0) {
        config.defaults = parsedDefaults;
      }
    }
  }
  if (obj.agents !== undefined) {
    if (!obj.agents || typeof obj.agents !== "object" || Array.isArray(obj.agents)) {
      warnings.push("Config warning at agents: expected object — using default");
    } else {
      const parsedAgents = {};
      for (const [agentName, agentValue] of Object.entries(obj.agents)) {
        const agentResult = agentConfig.safeParse(agentValue);
        if (agentResult.success) {
          parsedAgents[agentName] = agentResult.data;
          continue;
        }
        for (const issue of agentResult.error.issues) {
          const suffix = issue.path.length > 0 ? `.${formatPath(issue.path)}` : "";
          warnings.push(`Config warning at agents.${agentName}${suffix}: ${issue.message} — using default`);
        }
      }
      config.agents = parsedAgents;
    }
  }
  if (obj.patterns !== undefined) {
    const patternsResult = z.array(z.string()).safeParse(obj.patterns);
    if (patternsResult.success) {
      config.patterns = patternsResult.data;
    } else {
      for (const issue of patternsResult.error.issues) {
        const suffix = issue.path.length > 0 ? `.${formatPath(issue.path)}` : "";
        warnings.push(`Config warning at patterns${suffix}: ${issue.message} — using default`);
      }
    }
  }
  if (obj.logging !== undefined) {
    const loggingResult = z.boolean().safeParse(obj.logging);
    if (loggingResult.success) {
      config.logging = loggingResult.data;
    } else {
      warnings.push(`Config warning at logging: ${loggingResult.error.issues[0].message} — using default`);
    }
  }
  if (obj.logLevel !== undefined) {
    const logLevelResult = z.enum(["debug", "info"]).safeParse(obj.logLevel);
    if (logLevelResult.success) {
      config.logLevel = logLevelResult.data;
    } else {
      warnings.push(`Config warning at logLevel: ${logLevelResult.error.issues[0].message} — using default`);
    }
  }
  if (obj.logPath !== undefined) {
    const logPathResult = logPathSchema.safeParse(obj.logPath);
    if (logPathResult.success) {
      config.logPath = obj.logPath;
    } else {
      for (const issue of logPathResult.error.issues) {
        const suffix = issue.path.length > 0 ? `.${formatPath(issue.path)}` : "";
        warnings.push(`Config warning at logPath${suffix}: ${issue.message} — using default`);
      }
    }
  }
  if (obj.agentDirs !== undefined) {
    const agentDirsResult = z.array(z.string()).safeParse(obj.agentDirs);
    if (agentDirsResult.success) {
      config.agentDirs = agentDirsResult.data;
    } else {
      for (const issue of agentDirsResult.error.issues) {
        const suffix = issue.path.length > 0 ? `.${formatPath(issue.path)}` : "";
        warnings.push(`Config warning at agentDirs${suffix}: ${issue.message} — using default`);
      }
    }
  }
  return { config, warnings };
}
function mergeWithDefaults(raw) {
  const def = DEFAULT_CONFIG;
  const logPath = raw.logPath ? normalizeLogPath(raw.logPath) : def.logPath;
  return {
    enabled: raw.enabled ?? def.enabled,
    defaults: {
      fallbackOn: raw.defaults?.fallbackOn ?? def.defaults.fallbackOn,
      cooldownMs: raw.defaults?.cooldownMs ?? def.defaults.cooldownMs,
      retryOriginalAfterMs: raw.defaults?.retryOriginalAfterMs ?? def.defaults.retryOriginalAfterMs,
      maxFallbackDepth: raw.defaults?.maxFallbackDepth ?? def.defaults.maxFallbackDepth
    },
    agents: raw.agents ?? def.agents,
    patterns: raw.patterns ?? def.patterns,
    logging: raw.logging ?? def.logging,
    logLevel: raw.logLevel ?? def.logLevel,
    logPath,
    agentDirs: raw.agentDirs ?? def.agentDirs
  };
}

// src/config/loader.ts
var CONFIG_FILENAME = "model-fallback.json";
var OLD_CONFIG_FILENAME = "rate-limit-fallback.json";
function candidatePaths(directory, homeDir = homedir4()) {
  return [
    join3(directory, ".opencode", CONFIG_FILENAME),
    join3(homeDir, ".config", "opencode", CONFIG_FILENAME),
    join3(directory, ".opencode", OLD_CONFIG_FILENAME),
    join3(homeDir, ".config", "opencode", OLD_CONFIG_FILENAME)
  ];
}
function decodeJsonFile(buffer) {
  if (!buffer || buffer.length === 0)
    return "";
  if (buffer.length >= 2 && buffer[0] === 255 && buffer[1] === 254) {
    return buffer.subarray(2).toString("utf16le").replace(/^\uFEFF/, "");
  }
  if (buffer.length >= 2 && buffer[0] === 254 && buffer[1] === 255) {
    throw new Error("UTF-16BE JSON is not supported");
  }
  let text = buffer.toString("utf8");
  if (text.charCodeAt(0) === 65279)
    text = text.slice(1);
  if (text.includes("\0")) {
    const sample = buffer.subarray(0, Math.min(buffer.length, 256));
    let oddNulls = 0;
    for (let i = 1;i < sample.length; i += 2) {
      if (sample[i] === 0)
        oddNulls++;
    }
    if (oddNulls > sample.length / 8) {
      text = buffer.toString("utf16le").replace(/^\uFEFF/, "");
    }
  }
  return text;
}
function loadConfig(directory, homeDir = homedir4()) {
  const agentFileConfigs = loadAgentFallbackConfigs(directory, homeDir);
  const candidates = candidatePaths(directory, homeDir);
  for (const candidate of candidates) {
    if (!existsSync2(candidate))
      continue;
    let raw;
    try {
      raw = JSON.parse(decodeJsonFile(readFileSync2(candidate)));
    } catch {
      return {
        config: {
          ...DEFAULT_CONFIG,
          agents: { ...agentFileConfigs, ...DEFAULT_CONFIG.agents }
        },
        path: candidate,
        warnings: [`Failed to parse ${basename2(candidate)}: invalid JSON — using defaults`],
        migrated: false
      };
    }
    const isOld = isOldFormat(raw);
    if (isOld) {
      raw = migrateOldConfig(raw);
    }
    const { config: parsed, warnings } = parseConfig(raw);
    const merged = mergeWithDefaults(parsed);
    merged.agents = { ...agentFileConfigs, ...merged.agents };
    return {
      config: merged,
      path: candidate,
      warnings,
      migrated: isOld
    };
  }
  return {
    config: {
      ...DEFAULT_CONFIG,
      agents: { ...agentFileConfigs, ...DEFAULT_CONFIG.agents }
    },
    path: null,
    warnings: [],
    migrated: false
  };
}

// src/detection/patterns.ts
function matchesAnyPattern(text, patterns) {
  const lower = text.toLowerCase();
  return patterns.some((p) => lower.includes(p.toLowerCase()));
}

// src/detection/classifier.ts
var RATE_LIMIT_PATTERNS = [
  "rate limit",
  "ratelimit",
  "too many requests",
  "usage limit",
  "resource exhausted",
  "resource_exhausted",
  "stream error",
  "429"
];
var QUOTA_PATTERNS = [
  "quota exceeded",
  "credits exhausted",
  "billing limit",
  "credit limit",
  "insufficient quota",
  "insufficient credit",
  "insufficient credits",
  "out of credits"
];
var OVERLOADED_PATTERNS = [
  "overloaded",
  "capacity exceeded",
  "server is busy",
  "engine is currently overloaded"
];
var TIMEOUT_PATTERNS = ["timeout", "timed out", "request timeout", "connection timeout"];
var SERVER_ERROR_PATTERNS = [
  "internal server error",
  "bad gateway",
  "service unavailable",
  "gateway timeout",
  "500",
  "502",
  "503",
  "504"
];
function classifyError(message, statusCode) {
  const text = message.toLowerCase();
  if (statusCode === 429 || matchesAnyPattern(text, RATE_LIMIT_PATTERNS)) {
    return "rate_limit";
  }
  if (statusCode === 402 || matchesAnyPattern(text, QUOTA_PATTERNS)) {
    return "quota_exceeded";
  }
  if (statusCode === 529 || matchesAnyPattern(text, OVERLOADED_PATTERNS)) {
    return "overloaded";
  }
  if (matchesAnyPattern(text, TIMEOUT_PATTERNS)) {
    return "timeout";
  }
  if (statusCode !== undefined && statusCode >= 500 || matchesAnyPattern(text, SERVER_ERROR_PATTERNS)) {
    return "5xx";
  }
  return "unknown";
}

// src/display/notifier.ts
async function notifyFallback(client, from, to, reason) {
  const fromLabel = from ? labelModel(from) : "current model";
  const message = `Model fallback: switched from ${fromLabel} to ${labelModel(to)} (${reason})`;
  await client.tui.showToast({
    body: {
      title: "Model Fallback",
      message,
      variant: "warning",
      duration: 6000
    }
  }).catch(() => {});
}
async function notifyFallbackActive(client, originalModel, currentModel) {
  const message = `Using ${labelModel(currentModel)} (fallback from ${labelModel(originalModel)})`;
  await client.tui.showToast({
    body: {
      title: "Fallback Active",
      message,
      variant: "warning",
      duration: 4000
    }
  }).catch(() => {});
}
async function notifyRecovery(client, originalModel) {
  const message = `Original model ${labelModel(originalModel)} is available again`;
  await client.tui.showToast({
    body: {
      title: "Model Recovered",
      message,
      variant: "info",
      duration: 5000
    }
  }).catch(() => {});
}
function labelModel(key) {
  const slash = key.indexOf("/");
  if (slash === -1)
    return key;
  const provider = key.slice(0, slash);
  const model = key.slice(slash + 1);
  return `${model} [${provider}]`;
}
function splitModelKey(key) {
  const slash = key.indexOf("/");
  if (slash === -1)
    return null;
  return {
    providerID: key.slice(0, slash),
    modelID: key.slice(slash + 1)
  };
}
function modelKeyFromObject(model) {
  if (!model || typeof model !== "object")
    return null;
  if (typeof model.providerID !== "string" || typeof model.modelID !== "string")
    return null;
  return `${model.providerID}/${model.modelID}`;
}
function setOutputMessageModel(output, modelKey2) {
  const parsed = splitModelKey(modelKey2);
  if (!parsed)
    return false;
  output.message.model = parsed;
  return true;
}

// src/logging/logger.ts
import { appendFileSync, mkdirSync, writeFileSync } from "fs";
import { dirname } from "path";

class Logger {
  client;
  logPath;
  enabled;
  minLevel;
  dirCreated = false;
  fileErrorNotified = false;
  constructor(client, logPath, enabled, minLevel = "info") {
    this.client = client;
    this.logPath = logPath;
    this.enabled = enabled;
    this.minLevel = minLevel;
  }
  log(level, event, fields = {}) {
    const sanitizedFields = sanitizeFields(fields);
    const entry = {
      ts: new Date().toISOString(),
      level,
      event,
      ...sanitizedFields
    };
    const shouldWrite = this.enabled && (this.minLevel === "debug" || level !== "debug");
    if (shouldWrite) {
      this.writeToFile(entry);
    }
    if (level !== "debug") {
      const message = `[model-fallback] ${event}${Object.keys(sanitizedFields).length ? " " + JSON.stringify(sanitizedFields) : ""}`;
      this.client.app.log({
        body: { service: "model-fallback", level, message }
      }).catch(() => {});
    }
  }
  info(event, fields) {
    this.log("info", event, fields);
  }
  warn(event, fields) {
    this.log("warn", event, fields);
  }
  error(event, fields) {
    this.log("error", event, fields);
  }
  debug(event, fields) {
    this.log("debug", event, fields);
  }
  writeToFile(entry) {
    try {
      if (!this.dirCreated) {
        mkdirSync(dirname(this.logPath), { recursive: true, mode: 448 });
        this.dirCreated = true;
      }
      try {
        writeFileSync(this.logPath, "", { mode: 384, flag: "ax" });
      } catch {}
      appendFileSync(this.logPath, JSON.stringify(entry) + `
`, "utf-8");
    } catch (err) {
      if (!this.fileErrorNotified) {
        this.fileErrorNotified = true;
        const message = `[model-fallback] logging.file.write.failed ${JSON.stringify({
          logPath: this.logPath,
          error: summarizeError(err)
        })}`;
        this.client.app.log({
          body: { service: "model-fallback", level: "warn", message }
        }).catch(() => {});
      }
    }
  }
}
function sanitizeFields(fields) {
  const out = {};
  for (const [key, value] of Object.entries(fields)) {
    out[key] = sanitizeValue(key, value);
  }
  return out;
}
function sanitizeValue(key, value) {
  if (value === null || value === undefined)
    return value;
  if (isSensitiveKey(key)) {
    if (typeof value === "string") {
      return { redacted: true, length: value.length };
    }
    if (value instanceof Error) {
      return { redacted: true, type: value.name, code: getErrorCode(value) };
    }
    return { redacted: true, type: typeof value };
  }
  if (value instanceof Error) {
    return { name: value.name, message: value.message };
  }
  return value;
}
function isSensitiveKey(key) {
  return /(?:^|_)(message|prompt|content|parts|error|err|stack|body)(?:$|_)/i.test(key);
}
function getErrorCode(err) {
  const code = err.code;
  return typeof code === "string" ? code : undefined;
}
function summarizeError(err) {
  if (err && typeof err === "object") {
    const e = err;
    return {
      type: typeof e.name === "string" ? e.name : "Error",
      code: typeof e.code === "string" ? e.code : undefined
    };
  }
  return { type: typeof err };
}

// src/resolution/agent-resolver.ts
function normalizeAgentName(agentName) {
  const compact = agentName.toLowerCase().replace(/[^a-z0-9]/g, "");
  return compact.endsWith("agent") ? compact.slice(0, -5) : compact;
}
async function resolveAgentName(client, sessionId, cachedName) {
  if (cachedName)
    return cachedName;
  try {
    const result = await client.session.messages({ path: { id: sessionId } });
    const entries = result.data;
    if (!Array.isArray(entries))
      return null;
    for (let i2 = entries.length - 1;i2 >= 0; i2--) {
      const { info } = entries[i2];
      if (info.role === "user" && typeof info.agent === "string") {
        return info.agent;
      }
    }
    return null;
  } catch {
    return null;
  }
}
function resolveFallbackModels(config, agentName) {
  if (agentName && config.agents[agentName]) {
    return config.agents[agentName].fallbackModels;
  }
  if (agentName) {
    const normalized = normalizeAgentName(agentName);
    const matches = Object.entries(config.agents).filter(([name]) => name !== "*" && normalizeAgentName(name) === normalized);
    if (matches.length === 1) {
      return matches[0][1].fallbackModels;
    }
  }
  return config.agents["*"]?.fallbackModels ?? [];
}
function uniqueModels(models) {
  const seen = /* @__PURE__ */ new Set();
  const result = [];
  for (const model of models) {
    if (!model || seen.has(model))
      continue;
    seen.add(model);
    result.push(model);
  }
  return result;
}
function resolveCompactionModelChain(config, primaryModel) {
  const explicit = config.agents.compaction?.models;
  if (Array.isArray(explicit) && explicit.length > 0)
    return uniqueModels(explicit);
  return uniqueModels([
    primaryModel,
    ...resolveFallbackModels(config, "compaction")
  ]);
}
function resolveExplicitFallbackModels(config, agentName) {
  if (!agentName)
    return [];
  if (config.agents[agentName]) {
    return config.agents[agentName].fallbackModels;
  }
  const normalized = normalizeAgentName(agentName);
  const matches = Object.entries(config.agents).filter(([name]) => name !== "*" && normalizeAgentName(name) === normalized);
  if (matches.length === 1) {
    return matches[0][1].fallbackModels;
  }
  return [];
}

// src/resolution/fallback-resolver.ts
function resolveFallbackModel(chain, currentModel, health) {
  const candidates = chain.filter((m) => m !== currentModel);
  const healthy = candidates.find((m) => health.get(m).state === "healthy");
  if (healthy)
    return healthy;
  const cooldown = candidates.find((m) => health.get(m).state === "cooldown");
  if (cooldown)
    return cooldown;
  return null;
}

// src/preemptive.ts
function tryPreemptiveRedirect(sessionId, modelKey2, agentName, store, config, logger) {
  const sessionState = store.sessions.get(sessionId);
  store.sessions.setOriginalModel(sessionId, modelKey2);
  if (sessionState.currentModel !== modelKey2) {
    const wasOnFallback = sessionState.currentModel !== null && sessionState.currentModel !== sessionState.originalModel;
    sessionState.currentModel = modelKey2;
    if (wasOnFallback && modelKey2 === sessionState.originalModel) {
      sessionState.fallbackDepth = 0;
      store.sessions.clearFallbackActiveNotification(sessionId);
      logger.debug("preemptive.depth.reset", { sessionId, modelKey: modelKey2 });
    }
  }
  const health = store.health.get(modelKey2);
  if (health.state !== "rate_limited") {
    return { redirected: false };
  }
  const chain = resolveFallbackModels(config, agentName);
  if (chain.length === 0) {
    logger.debug("preemptive.no-chain", { sessionId, agentName });
    return { redirected: false };
  }
  const fallbackModel = resolveFallbackModel(chain, modelKey2, store.health);
  if (!fallbackModel) {
    logger.debug("preemptive.all-exhausted", { sessionId });
    return { redirected: false };
  }
  logger.info("preemptive.redirect", {
    sessionId,
    agentName,
    agentFile: sessionState.agentFile,
    from: modelKey2,
    to: fallbackModel
  });
  store.sessions.recordPreemptiveRedirect(sessionId, modelKey2, fallbackModel, agentName);
  return { redirected: true, fallbackModel };
}
class RuntimeCompactionModelRouter {
  logger;
  config;
  primaryModel = null;
  unpinned = false;
  constructor(logger, config) {
    this.logger = logger;
    this.config = config;
  }
  configure(runtimeConfig) {
    const configuredModel = getConfiguredCompactionModel(runtimeConfig);
    if (configuredModel && !this.primaryModel)
      this.primaryModel = configuredModel;
    if (runtimeConfig?.agent?.compaction?.model !== undefined) {
      delete runtimeConfig.agent.compaction.model;
      this.unpinned = true;
    }
    this.logger.info("compaction.runtime.model.unpinned", {
      primaryModel: this.primaryModel,
      chain: this.chain(this.config)
    });
  }
  route(input, output, store, config) {
    if (!isCompactionChat(input, output))
      return false;
    const incomingModel = modelKeyFromObject(input.model) ?? modelKeyFromObject(output.message?.model);
    const targetModel = this.select(incomingModel, store, config);
    if (!targetModel)
      return false;
    if (!setOutputMessageModel(output, targetModel))
      return false;
    if (incomingModel !== targetModel) {
      this.logger.info("compaction.chat.model.routed", {
        sessionId: input.sessionID,
        from: incomingModel,
        to: targetModel,
        chain: this.chain(config)
      });
    } else {
      this.logger.debug("compaction.chat.model.kept", {
        sessionId: input.sessionID,
        model: targetModel
      });
    }
    return true;
  }
  chain(config) {
    return resolveCompactionModelChain(config, this.primaryModel);
  }
  select(incomingModel, store, config) {
    const chain = this.chain(config);
    if (chain.length === 0)
      return null;
    const firstHealthy = chain.find((model) => store.health.get(model).state === "healthy");
    if (firstHealthy)
      return firstHealthy;
    const firstCooldown = chain.find((model) => store.health.get(model).state === "cooldown");
    if (firstCooldown)
      return firstCooldown;
    if (incomingModel && chain.includes(incomingModel)) {
      return incomingModel;
    }
    return null;
  }
}
function getConfiguredCompactionModel(runtimeConfig) {
  const model = runtimeConfig?.agent?.compaction?.model;
  if (typeof model === "string" && splitModelKey(model))
    return model;
  return null;
}
function isCompactionChat(input, output) {
  if (input.agent === "compaction")
    return true;
  if (output.message?.agent === "compaction")
    return true;
  return Array.isArray(output.parts) && output.parts.some((part) => part && typeof part === "object" && part.type === "compaction");
}
function trimLeadingNonUserMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0)
    return 0;
  const firstUser = messages.findIndex((entry) => entry?.info?.role === "user");
  if (firstUser <= 0)
    return 0;
  messages.splice(0, firstUser);
  return firstUser;
}

// src/replay/message-converter.ts
function convertPartsForPrompt(parts) {
  const result = [];
  if (!parts || !Array.isArray(parts)) {
    return result;
  }
  for (const part of parts) {
    if (!part || typeof part !== "object" || !("type" in part)) {
      continue;
    }
    if (part.type === "text") {
      if (part.synthetic || part.ignored)
        continue;
      result.push({ type: "text", text: part.text });
      continue;
    }
    if (part.type === "file") {
      result.push({
        type: "file",
        mime: part.mime,
        url: part.url,
        filename: part.filename
      });
      continue;
    }
    if (part.type === "agent") {
      result.push({ type: "agent", name: part.name });
      continue;
    }
  }
  return result;
}

// src/replay/orchestrator.ts
async function attemptFallback(sessionId, reason, client, store, config, logger, directory) {
  const sessionState = store.sessions.get(sessionId);
  if (!store.sessions.acquireLock(sessionId)) {
    logger.debug("fallback.skipped.locked", { sessionId });
    return { success: false, error: "already processing" };
  }
  try {
    if (store.sessions.isInDedupWindow(sessionId)) {
      logger.debug("fallback.skipped.dedup", { sessionId });
      return { success: false, error: "dedup window" };
    }
    const agentName = await resolveAgentName(client, sessionId, sessionState.agentName);
    if (agentName) {
      store.sessions.setAgentName(sessionId, agentName);
      if (!sessionState.agentFile) {
        const absPath = resolveAgentFile(agentName, directory, config.agentDirs?.length ? config.agentDirs : undefined);
        if (absPath)
          store.sessions.setAgentFile(sessionId, toRelativeAgentPath(absPath, directory));
      }
    }
    const chain = resolveFallbackModels(config, agentName);
    if (chain.length === 0) {
      logger.warn("fallback.no-chain", { sessionId, agentName });
      return { success: false, error: "no fallback chain configured" };
    }
    let messageEntries;
    try {
      const result = await client.session.messages({ path: { id: sessionId } });
      messageEntries = Array.isArray(result.data) ? result.data : [];
    } catch (err) {
      logger.error("replay.messages.failed", { sessionId, err });
      return { success: false, error: "messages fetch failed" };
    }
    const compaction = getLatestCompactionContext(messageEntries);
    if (compaction) {
      return await attemptCompactionFallback(sessionId, reason, compaction, client, store, config, logger);
    }
    let lastUserEntry = null;
    for (let i2 = messageEntries.length - 1;i2 >= 0; i2--) {
      const entry = messageEntries[i2];
      if (!entry || typeof entry !== "object")
        continue;
      const info = entry.info;
      if (!info || typeof info !== "object")
        continue;
      const role = info.role;
      if (role !== "user")
        continue;
      const id = info.id;
      if (typeof id !== "string")
        continue;
      const rawParts = entry.parts;
      const safeParts = sanitizeParts(rawParts);
      if (safeParts.length === 0 && Array.isArray(rawParts) && rawParts.length > 0) {
        continue;
      }
      const rawModel = info.model;
      let model;
      if (rawModel && typeof rawModel === "object") {
        const providerID2 = rawModel.providerID;
        const modelID2 = rawModel.modelID;
        if (typeof providerID2 === "string" && typeof modelID2 === "string") {
          model = { providerID: providerID2, modelID: modelID2 };
        }
      }
      lastUserEntry = {
        id,
        model,
        parts: safeParts
      };
      break;
    }
    if (!lastUserEntry) {
      logger.warn("replay.no-user-message", { sessionId });
      return { success: false, error: "no user message found" };
    }
    const msgModel = lastUserEntry.model;
    if (msgModel && sessionState.retryContextSource !== "assistant") {
      const modelKey2 = `${msgModel.providerID}/${msgModel.modelID}`;
      store.sessions.setOriginalModel(sessionId, modelKey2);
      if (sessionState.currentModel !== modelKey2) {
        const wasOnFallback = sessionState.currentModel !== null && sessionState.currentModel !== sessionState.originalModel;
        sessionState.currentModel = modelKey2;
        if (wasOnFallback && modelKey2 === sessionState.originalModel) {
          sessionState.fallbackDepth = 0;
          logger.debug("session.depth.reset", { sessionId, modelKey: modelKey2 });
        }
        logger.debug("session.model.synced", { sessionId, modelKey: modelKey2 });
      }
    } else if (msgModel) {
      logger.debug("session.model.sync.skipped", {
        sessionId,
        source: sessionState.retryContextSource,
        currentModel: sessionState.currentModel,
        userModel: `${msgModel.providerID}/${msgModel.modelID}`
      });
    }
    if (sessionState.fallbackDepth >= config.defaults.maxFallbackDepth) {
      logger.warn("fallback.exhausted", {
        sessionId,
        depth: sessionState.fallbackDepth,
        max: config.defaults.maxFallbackDepth
      });
      return { success: false, error: "max fallback depth reached" };
    }
    const fallbackModel = resolveFallbackModel(chain, sessionState.currentModel, store.health);
    if (!fallbackModel) {
      logger.warn("fallback.all-exhausted", { sessionId, chain });
      return { success: false, error: "all fallback models exhausted" };
    }
    const currentModel = sessionState.currentModel;
    if (currentModel && shouldMarkRateLimited(reason)) {
      store.health.markRateLimited(currentModel, config.defaults.cooldownMs, config.defaults.retryOriginalAfterMs);
    }
    sessionState.lastFallbackAt = Date.now();
    try {
      await client.session.abort({ path: { id: sessionId } });
      logger.debug("replay.abort.ok", { sessionId });
    } catch (err) {
      logger.error("replay.abort.failed", { sessionId, err });
      return { success: false, error: "abort failed" };
    }
    try {
      await client.session.revert({
        path: { id: sessionId },
        body: { messageID: lastUserEntry.id }
      });
      logger.debug("replay.revert.ok", {
        sessionId,
        messageID: lastUserEntry.id
      });
    } catch (err) {
      const revertApplied = await wasRevertApplied(client, sessionId, lastUserEntry.id, logger);
      if (!revertApplied) {
        logger.error("replay.revert.failed", { sessionId, err });
        return { success: false, error: "revert failed" };
      }
      logger.warn("replay.revert.recovered", {
        sessionId,
        messageID: lastUserEntry.id,
        errorType: err instanceof Error ? err.name : typeof err
      });
    }
    const promptParts = convertPartsForPrompt(lastUserEntry.parts);
    if (promptParts.length === 0) {
      promptParts.push({ type: "text", text: "" });
    }
    const [providerID, ...rest] = fallbackModel.split("/");
    const modelID = rest.join("/");
    try {
      await client.session.prompt({
        path: { id: sessionId },
        body: {
          model: { providerID, modelID },
          agent: agentName ?? undefined,
          parts: promptParts
        }
      });
      logger.debug("replay.prompt.ok", { sessionId, fallbackModel });
    } catch (err) {
      logger.error("replay.prompt.failed", {
        sessionId,
        fallbackModel,
        err
      });
      return { success: false, error: "prompt failed" };
    }
    const newDepth = sessionState.fallbackDepth + 1;
    store.sessions.recordFallback(sessionId, currentModel ?? fallbackModel, fallbackModel, reason, agentName);
    logger.info("fallback.success", {
      sessionId,
      agentName,
      agentFile: store.sessions.get(sessionId).agentFile,
      from: currentModel,
      to: fallbackModel,
      reason,
      depth: newDepth
    });
    return { success: true, fallbackModel, fromModel: currentModel };
  } finally {
    sessionState.retryContextSource = null;
    store.sessions.releaseLock(sessionId);
  }
}
var pendingCompactionSummaries = /* @__PURE__ */ new Set();
var pendingCompactionReroutes = /* @__PURE__ */ new Set();
var COMPACTION_FALLBACK_DELAY_MS = 500;
var COMPACTION_SUMMARIZE_TIMEOUT_MS = 3e4;
async function attemptCompactionFallback(sessionId, reason, compaction, client, store, config, logger) {
  const sessionState = store.sessions.get(sessionId);
  const chain = resolveFallbackModels(config, "compaction");
  if (chain.length === 0) {
    logger.warn("compaction.fallback.no-chain", { sessionId });
    return { success: false, error: "no compaction fallback chain configured" };
  }
  if (sessionState.fallbackDepth >= config.defaults.maxFallbackDepth) {
    logger.warn("compaction.fallback.exhausted", {
      sessionId,
      depth: sessionState.fallbackDepth,
      max: config.defaults.maxFallbackDepth
    });
    return { success: false, error: "max fallback depth reached" };
  }
  const currentModel = compaction.currentModel ?? sessionState.currentModel;
  const fallbackModel = resolveFallbackModel(chain, currentModel, store.health);
  if (!fallbackModel) {
    logger.warn("compaction.fallback.all-exhausted", {
      sessionId,
      currentModel,
      chain
    });
    return { success: false, error: "all compaction fallback models exhausted" };
  }
  if (currentModel && shouldMarkRateLimited(reason)) {
    store.health.markRateLimited(currentModel, config.defaults.cooldownMs, config.defaults.retryOriginalAfterMs);
  }
  sessionState.lastFallbackAt = Date.now();
  try {
    await client.session.abort({ path: { id: sessionId } });
    logger.debug("compaction.abort.ok", { sessionId });
  } catch (err) {
    logger.warn("compaction.abort.failed", { sessionId, err });
  }
  const [providerID, ...rest] = fallbackModel.split("/");
  const modelID = rest.join("/");
  const scheduled = scheduleCompactionSummarize({
    sessionId,
    reason,
    currentModel,
    fallbackModel,
    providerID,
    modelID,
    auto: compaction.auto === true,
    client,
    store,
    logger
  });
  if (!scheduled)
    return { success: false, error: "compaction summarize already pending" };
  logger.info("compaction.fallback.scheduled", {
    sessionId,
    from: currentModel,
    to: fallbackModel,
    reason,
    auto: compaction.auto === true
  });
  return { success: true, fallbackModel, fromModel: currentModel };
}
function scheduleCompactionSummarize({
  sessionId,
  reason,
  currentModel,
  fallbackModel,
  providerID,
  modelID,
  auto,
  client,
  store,
  logger
}) {
  if (pendingCompactionSummaries.has(sessionId)) {
    logger.debug("compaction.summarize.already-pending", {
      sessionId,
      fallbackModel
    });
    return false;
  }
  pendingCompactionSummaries.add(sessionId);
  const delayTimer = setTimeout(() => {
    void (async () => {
      try {
        await withTimeout(
          () => client.session.summarize({
            path: { id: sessionId },
            body: { providerID, modelID, auto }
          }),
          COMPACTION_SUMMARIZE_TIMEOUT_MS,
          `compaction summarize timed out after ${COMPACTION_SUMMARIZE_TIMEOUT_MS}ms`
        );
        logger.debug("compaction.summarize.ok", {
          sessionId,
          fallbackModel,
          auto
        });
        store.sessions.recordFallback(sessionId, currentModel ?? fallbackModel, fallbackModel, reason, "compaction");
        logger.info("compaction.fallback.success", {
          sessionId,
          from: currentModel,
          to: fallbackModel,
          reason,
          auto
        });
      } catch (err) {
        logger.error("compaction.summarize.failed", {
          sessionId,
          fallbackModel,
          err
        });
      } finally {
        pendingCompactionSummaries.delete(sessionId);
      }
    })();
  }, COMPACTION_FALLBACK_DELAY_MS);
  if (typeof delayTimer.unref === "function")
    delayTimer.unref();
  logger.info("compaction.summarize.scheduled", {
    sessionId,
    fallbackModel,
    delayMs: COMPACTION_FALLBACK_DELAY_MS,
    timeoutMs: COMPACTION_SUMMARIZE_TIMEOUT_MS,
    auto
  });
  return true;
}
function withTimeout(operation, timeoutMs, message) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
    if (typeof timeoutId.unref === "function")
      timeoutId.unref();
  });
  return Promise.race([
    Promise.resolve().then(operation),
    timeout
  ]).finally(() => clearTimeout(timeoutId));
}
async function ensureCompactionUsesClosedChain(sessionId, auto, client, store, config, compactionRouter, logger) {
  if (!sessionId)
    return;
  let entries;
  try {
    const result = await client.session.messages({ path: { id: sessionId } });
    entries = result.data ?? [];
  } catch (err) {
    logger.warn("compaction.reroute.messages.failed", { sessionId, err });
    return;
  }
  const compaction = getLatestCompactionUserEntry(entries);
  if (!compaction)
    return;
  const currentModel = getMessageModelKey(compaction.entry.info);
  const targetModel = compactionRouter.select(currentModel, store, config);
  if (!targetModel)
    return;
  if (currentModel === targetModel) {
    logger.debug("compaction.reroute.kept", { sessionId, model: currentModel });
    return;
  }
  const key = `${sessionId}:${compaction.entry.info.id}:${targetModel}`;
  if (pendingCompactionReroutes.has(key)) {
    logger.debug("compaction.reroute.already-pending", { sessionId, messageID: compaction.entry.info.id, targetModel });
    return;
  }
  pendingCompactionReroutes.add(key);
  try {
    await client.session.abort({ path: { id: sessionId } });
    logger.debug("compaction.reroute.abort.ok", { sessionId, messageID: compaction.entry.info.id });
  } catch (err) {
    logger.warn("compaction.reroute.abort.failed", { sessionId, err });
  }
  const revertTo = findPreviousNonCompactionUser(entries, compaction.index);
  if (revertTo) {
    try {
      await client.session.revert({
        path: { id: sessionId },
        body: { messageID: revertTo.info.id }
      });
      logger.debug("compaction.reroute.revert.ok", {
        sessionId,
        messageID: revertTo.info.id
      });
    } catch (err) {
      logger.warn("compaction.reroute.revert.failed", {
        sessionId,
        messageID: revertTo.info.id,
        err
      });
    }
  }
  const parsed = splitModelKey(targetModel);
  if (!parsed)
    return;
  try {
    await client.session.summarize({
      path: { id: sessionId },
      body: {
        providerID: parsed.providerID,
        modelID: parsed.modelID,
        auto: auto ?? compaction.auto
      }
    });
    logger.info("compaction.reroute.success", {
      sessionId,
      from: currentModel,
      to: targetModel,
      messageID: compaction.entry.info.id,
      chain: compactionRouter.chain(config)
    });
  } catch (err) {
    logger.error("compaction.reroute.summarize.failed", {
      sessionId,
      from: currentModel,
      to: targetModel,
      err
    });
  } finally {
    pendingCompactionReroutes.delete(key);
  }
}
function getLatestCompactionUserEntry(entries) {
  for (let i2 = entries.length - 1;i2 >= 0; i2--) {
    const entry = entries[i2];
    if (!entry?.info || entry.info.role !== "user")
      continue;
    const compactionPart = getCompactionPart(entry);
    if (!compactionPart && entry.info.agent !== "compaction")
      continue;
    return {
      entry,
      index: i2,
      auto: compactionPart?.auto === true
    };
  }
  return null;
}
function findPreviousNonCompactionUser(entries, beforeIndex) {
  for (let i2 = beforeIndex - 1;i2 >= 0; i2--) {
    const entry = entries[i2];
    if (!entry?.info || entry.info.role !== "user")
      continue;
    if (getCompactionPart(entry))
      continue;
    return entry;
  }
  return null;
}
function getLatestCompactionContext(messageEntries) {
  let currentModel = null;
  for (let i2 = messageEntries.length - 1;i2 >= 0; i2--) {
    const entry = messageEntries[i2];
    if (!entry || typeof entry !== "object")
      continue;
    const info = entry.info;
    if (!info || typeof info !== "object")
      continue;
    if (info.role === "assistant" && isCompactionAssistant(info)) {
      currentModel = getMessageModelKey(info) ?? currentModel;
      continue;
    }
    if (info.role !== "user")
      continue;
    const compactionPart = getCompactionPart(entry);
    if (!compactionPart && info.agent !== "compaction")
      continue;
    return {
      currentModel,
      auto: compactionPart?.auto === true
    };
  }
  return null;
}
function isCompactionAssistant(info) {
  return info.agent === "compaction" || info.mode === "compaction" || info.summary === true;
}
function getCompactionPart(entry) {
  const parts = entry.parts;
  if (!Array.isArray(parts))
    return null;
  return parts.find((part) => part && typeof part === "object" && part.type === "compaction") ?? null;
}
function shouldMarkRateLimited(reason) {
  return reason === "rate_limit" || reason === "quota_exceeded";
}
function sanitizeParts(parts) {
  if (!Array.isArray(parts))
    return [];
  return parts.filter((part) => typeof part === "object" && part !== null && ("type" in part));
}
async function wasRevertApplied(client, sessionId, expectedMessageId, logger) {
  try {
    const result = await client.session.get({ path: { id: sessionId } });
    const revertInfo = getSessionRevertInfo(result.data);
    return revertInfo?.messageID === expectedMessageId;
  } catch (err) {
    logger.warn("replay.revert.verify.failed", {
      sessionId,
      messageID: expectedMessageId,
      errorType: err instanceof Error ? err.name : typeof err
    });
    return false;
  }
}
function getSessionRevertInfo(session) {
  if (!session || typeof session !== "object")
    return null;
  const revert = session.revert;
  if (!revert || typeof revert !== "object")
    return null;
  const messageID = revert.messageID;
  if (typeof messageID !== "string")
    return null;
  return { messageID };
}

// src/state/model-health.ts
class ModelHealthStore {
  store = new Map;
  timer = null;
  onTransition;
  constructor(opts) {
    this.onTransition = opts?.onTransition;
    this.timer = setInterval(() => this.tick(), 30000).unref();
  }
  get(modelKey2) {
    return this.store.get(modelKey2) ?? this.newHealth(modelKey2);
  }
  markRateLimited(modelKey2, cooldownMs, retryOriginalAfterMs) {
    const now = Date.now();
    const existing = this.get(modelKey2);
    const health = {
      ...existing,
      state: "rate_limited",
      lastFailure: now,
      failureCount: existing.failureCount + 1,
      cooldownExpiresAt: now + cooldownMs,
      retryOriginalAt: now + retryOriginalAfterMs
    };
    this.store.set(modelKey2, health);
  }
  isUsable(modelKey2) {
    const h = this.get(modelKey2);
    return h.state === "healthy" || h.state === "cooldown";
  }
  preferScore(modelKey2) {
    const state = this.get(modelKey2).state;
    if (state === "healthy")
      return 2;
    if (state === "cooldown")
      return 1;
    return 0;
  }
  getAll() {
    return Array.from(this.store.values());
  }
  destroy() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
  tick() {
    const now = Date.now();
    for (const [key, health] of this.store) {
      if (health.state === "rate_limited" && health.cooldownExpiresAt && now >= health.cooldownExpiresAt) {
        const next = { ...health, state: "cooldown" };
        this.store.set(key, next);
        this.onTransition?.(key, "rate_limited", "cooldown");
      } else if (health.state === "cooldown" && health.retryOriginalAt && now >= health.retryOriginalAt) {
        const next = {
          ...health,
          state: "healthy",
          cooldownExpiresAt: null,
          retryOriginalAt: null
        };
        this.store.set(key, next);
        this.onTransition?.(key, "cooldown", "healthy");
      }
    }
  }
  newHealth(modelKey2) {
    return {
      modelKey: modelKey2,
      state: "healthy",
      lastFailure: null,
      failureCount: 0,
      cooldownExpiresAt: null,
      retryOriginalAt: null
    };
  }
}

// src/state/session-state.ts
class SessionStateStore {
  store = new Map;
  getFallbackActiveKey(originalModel, currentModel) {
    return `${originalModel}->${currentModel}`;
  }
  get(sessionId) {
    let state = this.store.get(sessionId);
    if (!state) {
      state = this.newState(sessionId);
      this.store.set(sessionId, state);
    }
    return state;
  }
  acquireLock(sessionId) {
    const state = this.get(sessionId);
    if (state.isProcessing)
      return false;
    state.isProcessing = true;
    return true;
  }
  releaseLock(sessionId) {
    const state = this.store.get(sessionId);
    if (state)
      state.isProcessing = false;
  }
  isInDedupWindow(sessionId, windowMs = 3000) {
    const state = this.get(sessionId);
    if (!state.lastFallbackAt)
      return false;
    return Date.now() - state.lastFallbackAt < windowMs;
  }
  recordFallback(sessionId, fromModel, toModel, reason, agentName) {
    const state = this.get(sessionId);
    const event = {
      at: Date.now(),
      fromModel,
      toModel,
      reason,
      sessionId,
      trigger: "reactive",
      agentName
    };
    state.currentModel = toModel;
    state.fallbackDepth++;
    state.lastFallbackAt = event.at;
    state.recoveryNotifiedForModel = null;
    state.fallbackHistory.push(event);
    if (agentName)
      state.agentName = agentName;
  }
  recordPreemptiveRedirect(sessionId, fromModel, toModel, agentName) {
    const state = this.get(sessionId);
    const event = {
      at: Date.now(),
      fromModel,
      toModel,
      reason: "rate_limit",
      sessionId,
      trigger: "preemptive",
      agentName
    };
    state.currentModel = toModel;
    state.fallbackDepth++;
    state.recoveryNotifiedForModel = null;
    state.fallbackHistory.push(event);
    if (agentName)
      state.agentName = agentName;
  }
  setOriginalModel(sessionId, model) {
    const state = this.get(sessionId);
    if (!state.originalModel) {
      state.originalModel = model;
      state.currentModel = model;
      state.fallbackActiveNotifiedKey = null;
    }
  }
  consumeFallbackActiveNotification(sessionId) {
    const state = this.get(sessionId);
    const { originalModel, currentModel } = state;
    if (!originalModel || !currentModel || originalModel === currentModel)
      return null;
    const key = this.getFallbackActiveKey(originalModel, currentModel);
    if (state.fallbackActiveNotifiedKey === key)
      return null;
    state.fallbackActiveNotifiedKey = key;
    return { originalModel, currentModel };
  }
  clearFallbackActiveNotification(sessionId) {
    const state = this.store.get(sessionId);
    if (!state)
      return;
    state.fallbackActiveNotifiedKey = null;
  }
  setAgentName(sessionId, agentName) {
    const state = this.get(sessionId);
    state.agentName = agentName;
  }
  setAgentFile(sessionId, agentFile) {
    const state = this.get(sessionId);
    state.agentFile = agentFile;
  }
  partialReset(sessionId) {
    const state = this.store.get(sessionId);
    if (!state)
      return;
    state.fallbackHistory = [];
    state.lastFallbackAt = null;
    state.isProcessing = false;
    state.fallbackActiveNotifiedKey = null;
  }
  delete(sessionId) {
    this.store.delete(sessionId);
  }
  getAll() {
    return Array.from(this.store.values());
  }
  newState(sessionId) {
    return {
      sessionId,
      agentName: null,
      agentFile: null,
      originalModel: null,
      currentModel: null,
      retryContextSource: null,
      fallbackDepth: 0,
      isProcessing: false,
      lastFallbackAt: null,
      fallbackHistory: [],
      recoveryNotifiedForModel: null,
      fallbackActiveNotifiedKey: null
    };
  }
}

// src/state/store.ts
class FallbackStore {
  health;
  sessions;
  constructor(_config, logger) {
    this.sessions = new SessionStateStore;
    this.health = new ModelHealthStore({
      onTransition: (modelKey2, from, to) => {
        logger.info("health.transition", { modelKey: modelKey2, from, to });
      }
    });
  }
  destroy() {
    this.health.destroy();
  }
}

// src/tools/fallback-status.ts
import { tool } from "@opencode-ai/plugin";

// src/display/usage.ts
async function getFallbackUsage(client, state) {
  const summary = {
    sessionId: state.sessionId,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCost: 0,
    fallbackPeriods: []
  };
  try {
    const result = await client.session.messages({ path: { id: state.sessionId } });
    const entries = result.data ?? [];
    for (const entry of entries) {
      const msg = entry.info;
      if (msg.role !== "assistant")
        continue;
      summary.totalInputTokens += msg.tokens?.input ?? 0;
      summary.totalOutputTokens += msg.tokens?.output ?? 0;
      summary.totalCost += msg.cost ?? 0;
    }
    for (let i2 = 0;i2 < state.fallbackHistory.length; i2++) {
      const event = state.fallbackHistory[i2];
      const nextEvent = state.fallbackHistory[i2 + 1];
      const periodTokens = getPeriodTokens(entries, event.at, nextEvent?.at ?? null);
      summary.fallbackPeriods.push({
        model: event.toModel,
        from: event.at,
        to: nextEvent?.at ?? null,
        ...periodTokens
      });
    }
  } catch {}
  return summary;
}
function getPeriodTokens(entries, fromMs, toMs) {
  let inputTokens = 0;
  let outputTokens = 0;
  let cost = 0;
  for (const entry of entries) {
    const msg = entry.info;
    if (msg.role !== "assistant")
      continue;
    const created = msg.time.created;
    if (created < fromMs)
      continue;
    if (toMs !== null && created >= toMs)
      continue;
    inputTokens += msg.tokens?.input ?? 0;
    outputTokens += msg.tokens?.output ?? 0;
    cost += msg.cost ?? 0;
  }
  return { inputTokens, outputTokens, cost };
}

// src/tools/fallback-status.ts
function createFallbackStatusTool(store, config, client, directory) {
  return tool({
    description: "Show the current model fallback status: which models are healthy/rate-limited, fallback history for this session, and usage breakdown by model.",
    args: {
      verbose: tool.schema.boolean().optional().describe("Include detailed token/cost usage per model period")
    },
    async execute(args, context) {
      const sessionId = context.sessionID;
      const sessionState = store.sessions.get(sessionId);
      const allHealth = store.health.getAll();
      let activeModel = null;
      let agentName = sessionState.agentName;
      if (!sessionState.originalModel) {
        try {
          const msgs = await client.session.messages({
            path: { id: sessionId }
          });
          const latestUserMessage = getLastUserModelAndAgent(msgs.data);
          if (latestUserMessage) {
            activeModel = latestUserMessage.modelKey;
            if (!agentName && latestUserMessage.agentName) {
              agentName = latestUserMessage.agentName;
            }
          }
        } catch {}
      }
      const agentFile = agentName ? resolveAgentFile(agentName, directory, config.agentDirs.length ? config.agentDirs : undefined) : null;
      const agentLabel = agentName ? agentFile ? `${agentName} (${agentFile})` : agentName : "(unknown)";
      const lines = [`## Model Fallback Status
`];
      lines.push(`**Plugin:** ${config.enabled ? "enabled" : "disabled"}`);
      lines.push("");
      lines.push("### Current Session");
      lines.push(`- **Session ID:** ${sessionId}`);
      lines.push(`- **Agent:** ${agentLabel}`);
      lines.push(`- **Original model:** ${sessionState.originalModel ?? activeModel ?? "(not set)"}`);
      lines.push(`- **Current model:** ${sessionState.currentModel ?? activeModel ?? "(not set)"}`);
      lines.push(`- **Fallback depth:** ${sessionState.fallbackDepth}`);
      lines.push("");
      if (sessionState.fallbackHistory.length > 0) {
        lines.push("### Fallback History");
        for (const event of sessionState.fallbackHistory) {
          const time = new Date(event.at).toLocaleTimeString();
          const eventKind = event.trigger === "preemptive" ? "preemptive" : "reactive";
          const eventAgent = event.agentName ?? agentName;
          lines.push(`- **${time}** — \`${event.fromModel}\` → \`${event.toModel}\` (${event.reason}, ${eventKind})` + (eventAgent ? ` · agent: ${eventAgent}` : ""));
        }
        lines.push("");
      }
      lines.push("### Model Health");
      if (allHealth.length === 0) {
        lines.push("- All models healthy (no issues detected)");
      } else {
        for (const h of allHealth) {
          const stateEmoji = h.state === "healthy" ? "✓" : h.state === "cooldown" ? "~" : "✗";
          let detail = `- \`${h.modelKey}\` — **${h.state}** ${stateEmoji}`;
          if (h.state === "rate_limited" && h.cooldownExpiresAt) {
            const secsLeft = Math.max(0, Math.round((h.cooldownExpiresAt - Date.now()) / 1000));
            detail += ` (cooldown in ${secsLeft}s)`;
          } else if (h.state === "cooldown" && h.retryOriginalAt) {
            const secsLeft = Math.max(0, Math.round((h.retryOriginalAt - Date.now()) / 1000));
            detail += ` (recovery in ${secsLeft}s)`;
          }
          if (h.failureCount > 0)
            detail += ` [${h.failureCount} failures]`;
          lines.push(detail);
        }
      }
      lines.push("");
      if (args.verbose && sessionState.fallbackHistory.length > 0) {
        const usage = await getFallbackUsage(client, sessionState);
        lines.push("### Usage Summary");
        lines.push(`- **Total input tokens:** ${usage.totalInputTokens.toLocaleString()}`);
        lines.push(`- **Total output tokens:** ${usage.totalOutputTokens.toLocaleString()}`);
        lines.push(`- **Total cost:** $${usage.totalCost.toFixed(6)}`);
        if (usage.fallbackPeriods.length > 0) {
          lines.push("");
          lines.push("**By model period:**");
          for (const period of usage.fallbackPeriods) {
            const from = new Date(period.from).toLocaleTimeString();
            const to = period.to ? new Date(period.to).toLocaleTimeString() : "now";
            lines.push(`- \`${period.model}\` (${from}–${to}): ${period.inputTokens.toLocaleString()} in / ${period.outputTokens.toLocaleString()} out / $${period.cost.toFixed(6)}`);
          }
        }
      }
      return lines.join(`
`);
    }
  });
}
function getLastUserModelAndAgent(data) {
  if (!Array.isArray(data))
    return null;
  for (let i2 = data.length - 1;i2 >= 0; i2--) {
    const entry = data[i2];
    if (!entry || typeof entry !== "object")
      continue;
    const info = entry.info;
    if (!info || typeof info !== "object")
      continue;
    if (info.role !== "user")
      continue;
    const model = info.model;
    if (!model || typeof model !== "object")
      continue;
    const providerID = model.providerID;
    const modelID = model.modelID;
    if (typeof providerID !== "string" || typeof modelID !== "string")
      continue;
    const agentName = info.agent;
    return {
      modelKey: `${providerID}/${modelID}`,
      agentName: typeof agentName === "string" ? agentName : null
    };
  }
  return null;
}

// src/plugin.ts
function resolveFallbackStatusCommandPath() {
  return join4(homedir5(), ".config", "opencode", "commands", "fallback-status.md");
}
function ensureFallbackStatusCommand(logger, cmdPath) {
  try {
    mkdirSync2(dirname2(cmdPath), { recursive: true, mode: 448 });
    writeFileSync2(cmdPath, `Call the fallback-status tool and display the full output.
`, {
      flag: "wx"
    });
  } catch (err) {
    if (err.code !== "EEXIST") {
      logger.warn("fallback-status.command.write.failed", { cmdPath, err });
    }
  }
}
var createPlugin = async ({ client, directory }) => {
  const { config, path: configPath, warnings, migrated } = loadConfig(directory);
  const logger = new Logger(client, config.logPath, config.logging, config.logLevel);
  logger.info("plugin.init", {
    configPath,
    enabled: config.enabled,
    migrated,
    agentCount: Object.keys(config.agents).length
  });
  for (const w of warnings) {
    logger.warn("config.warning", { warning: w });
  }
  if (migrated) {
    logger.info("config.migrated", {
      note: "Auto-migrated from old rate-limit-fallback.json format"
    });
  }
  if (!config.enabled) {
    logger.info("plugin.disabled");
    return {};
  }
  const cmdPath = resolveFallbackStatusCommandPath();
  ensureFallbackStatusCommand(logger, cmdPath);
  const store = new FallbackStore(config, logger);
  const compactionRouter = new RuntimeCompactionModelRouter(logger, config);
  const hooks = {
    async config(runtimeConfig) {
      compactionRouter.configure(runtimeConfig);
    },
    async event({ event }) {
      await handleEvent(event, client, store, config, logger, directory, compactionRouter);
    },
    "chat.message": async (input, output) => {
      if (compactionRouter.route(input, output, store, config))
        return;
      if (!input.model)
        return;
      const modelKey2 = `${input.model.providerID}/${input.model.modelID}`;
      const sessionState = store.sessions.get(input.sessionID);
      if (input.agent) {
        store.sessions.setAgentName(input.sessionID, input.agent);
        if (!sessionState.agentFile) {
          const absPath = resolveAgentFile(input.agent, directory, config.agentDirs?.length ? config.agentDirs : undefined);
          if (absPath) {
            store.sessions.setAgentFile(input.sessionID, toRelativeAgentPath(absPath, directory));
          }
        }
      }
      const result = tryPreemptiveRedirect(input.sessionID, modelKey2, sessionState.agentName, store, config, logger);
      if (result.redirected && result.fallbackModel) {
        const [providerID, ...rest] = result.fallbackModel.split("/");
        const modelID = rest.join("/");
        output.message.model = { providerID, modelID };
        logger.debug("chat.message.redirected", {
          sessionID: input.sessionID,
          from: modelKey2,
          to: result.fallbackModel
        });
      }
      const activeFallback = store.sessions.consumeFallbackActiveNotification(input.sessionID);
      if (activeFallback) {
        notifyFallbackActive(client, activeFallback.originalModel, activeFallback.currentModel).catch(() => {});
      }
    },
    "experimental.chat.messages.transform": async (_input, output) => {
      const removed = trimLeadingNonUserMessages(output.messages);
      if (removed > 0) {
        logger.info("compaction.history.trimmed", { removed });
      }
    },
    tool: {
      "fallback-status": createFallbackStatusTool(store, config, client, directory)
    }
  };
  return hooks;
};
async function handleEvent(event, client, store, config, logger, directory, compactionRouter) {
  logger.debug("event.received", { type: event.type });
  if (event.type === "message.part.updated") {
    const { sessionID, part } = event.properties;
    if (part?.type === "compaction") {
      await ensureCompactionUsesClosedChain(sessionID, part.auto === true, client, store, config, compactionRouter, logger);
    }
    return;
  }
  if (event.type === "message.updated") {
    const { sessionID, info } = event.properties;
    if (info?.role === "user" && info.agent === "compaction") {
      await ensureCompactionUsesClosedChain(sessionID, undefined, client, store, config, compactionRouter, logger);
    }
    return;
  }
  if (event.type === "session.status") {
    const { sessionID, status } = event.properties;
    if (status.type === "retry") {
      await handleRetry(sessionID, status.message, client, store, config, logger, directory);
    } else if (status.type === "idle") {
      await handleIdle(sessionID, client, store, config, logger);
    }
    return;
  }
  if (event.type === "session.error") {
    const { sessionID, error } = event.properties;
    if (!sessionID || !error)
      return;
    if (error.name === "APIError" || error.name === "AI_APICallError") {
      const apiMessage = typeof error.data?.message === "string" ? error.data.message : "";
      const apiStatusCode = typeof error.data?.statusCode === "number" ? error.data.statusCode : undefined;
      const category = classifyError(apiMessage, apiStatusCode);
      if (config.defaults.fallbackOn.includes(category)) {
        const result = await attemptFallback(sessionID, category, client, store, config, logger, directory);
        if (result.success && result.fallbackModel) {
          await notifyFallback(client, result.fromModel ?? null, result.fallbackModel, category);
        }
      }
    }
    return;
  }
  if (event.type === "session.deleted") {
    const sessionID = event.properties.info.id;
    store.sessions.delete(sessionID);
    return;
  }
  if (event.type === "session.compacted") {
    const sessionID = event.properties.sessionID;
    store.sessions.partialReset(sessionID);
    logger.info("session.compacted.reset", { sessionID });
    return;
  }
}
async function handleRetry(sessionId, message, client, store, config, logger, directory) {
  if (!matchesAnyPattern(message, config.patterns)) {
    const generic = await shouldFallbackOnGenericRetry(sessionId, client, store, config, logger, directory);
    if (!generic.shouldFallback) {
      logger.debug("retry.nomatch", {
        sessionId,
        messageLength: message.length,
        reason: generic.reason,
        agentName: generic.agentName,
        currentModel: generic.currentModel
      });
      return;
    }
    const category2 = "rate_limit";
    logger.info("retry.generic_fallback", {
      sessionId,
      messageLength: message.length,
      category: category2,
      agentName: generic.agentName,
      currentModel: generic.currentModel
    });
    const result = await attemptFallback(sessionId, category2, client, store, config, logger, directory);
    if (result.success && result.fallbackModel) {
      await notifyFallback(client, result.fromModel ?? null, result.fallbackModel, category2);
    }
    return;
  }
  const category = classifyError(message);
  if (!config.defaults.fallbackOn.includes(category)) {
    logger.debug("retry.ignored", {
      sessionId,
      category,
      messageLength: message.length
    });
    return;
  }
  const sessionState = store.sessions.get(sessionId);
  try {
    const msgs = await client.session.messages({ path: { id: sessionId } });
    const latestAssistantMessage = getLastAssistantModelAndAgent2(msgs.data);
    const latestUserMessage = getLastUserModelAndAgent2(msgs.data);
    const retryContext = latestAssistantMessage ?? (!sessionState.currentModel ? latestUserMessage : null);
    if (retryContext?.modelKey) {
      store.sessions.setOriginalModel(sessionId, retryContext.modelKey);
      sessionState.currentModel = retryContext.modelKey;
      sessionState.retryContextSource = retryContext.source;
      if (retryContext.agentName) {
        store.sessions.setAgentName(sessionId, retryContext.agentName);
        const absPath = resolveAgentFile(retryContext.agentName, directory, config.agentDirs?.length ? config.agentDirs : undefined);
        if (absPath) {
          store.sessions.setAgentFile(sessionId, toRelativeAgentPath(absPath, directory));
        }
      }
    }
  } catch {}
  if (sessionState.agentName && !sessionState.agentFile) {
    const absPath = resolveAgentFile(sessionState.agentName, directory, config.agentDirs?.length ? config.agentDirs : undefined);
    if (absPath) {
      store.sessions.setAgentFile(sessionId, toRelativeAgentPath(absPath, directory));
    }
  }
  logger.info("retry.detected", {
    sessionId,
    messageLength: message.length,
    category,
    agentName: sessionState.agentName,
    agentFile: sessionState.agentFile
  });
  const result = await attemptFallback(sessionId, category, client, store, config, logger, directory);
  if (result.success && result.fallbackModel) {
    await notifyFallback(client, result.fromModel ?? null, result.fallbackModel, category);
  }
}
async function shouldFallbackOnGenericRetry(sessionId, client, store, config, logger, directory) {
  const sessionState = store.sessions.get(sessionId);
  if (sessionState.fallbackDepth > 0) {
    return {
      shouldFallback: false,
      reason: "generic-after-fallback",
      agentName: sessionState.agentName,
      currentModel: sessionState.currentModel
    };
  }
  let agentName = sessionState.agentName;
  if (!agentName || !sessionState.currentModel) {
    try {
      const msgs = await client.session.messages({ path: { id: sessionId } });
      const latestUserMessage = getLastUserModelAndAgent2(msgs.data);
      if (latestUserMessage?.modelKey) {
        store.sessions.setOriginalModel(sessionId, latestUserMessage.modelKey);
        if (!sessionState.currentModel) {
          sessionState.currentModel = latestUserMessage.modelKey;
        }
      }
      if (latestUserMessage?.agentName) {
        agentName = latestUserMessage.agentName;
        store.sessions.setAgentName(sessionId, agentName);
      }
    } catch (err) {
      logger.debug("retry.generic.inspect.failed", {
        sessionId,
        err
      });
    }
  }
  if (!agentName) {
    return { shouldFallback: false, reason: "no-agent", agentName: null, currentModel: sessionState.currentModel };
  }
  const chain = resolveExplicitFallbackModels(config, agentName);
  if (chain.length === 0) {
    return { shouldFallback: false, reason: "no-explicit-chain", agentName, currentModel: sessionState.currentModel };
  }
  if (!sessionState.currentModel && sessionState.originalModel) {
    sessionState.currentModel = sessionState.originalModel;
  }
  if (!sessionState.currentModel) {
    return { shouldFallback: false, reason: "no-current-model", agentName, currentModel: null };
  }
  if (!sessionState.agentFile) {
    const absPath = resolveAgentFile(agentName, directory, config.agentDirs?.length ? config.agentDirs : undefined);
    if (absPath) {
      store.sessions.setAgentFile(sessionId, toRelativeAgentPath(absPath, directory));
    }
  }
  return { shouldFallback: true, agentName, currentModel: sessionState.currentModel };
}
async function handleIdle(sessionId, client, store, _config, logger) {
  const state = store.sessions.get(sessionId);
  if (!state.originalModel)
    return;
  if (state.currentModel === state.originalModel) {
    state.recoveryNotifiedForModel = null;
    state.fallbackActiveNotifiedKey = null;
    return;
  }
  const health = store.health.get(state.originalModel);
  if (health.state !== "healthy") {
    state.recoveryNotifiedForModel = null;
    return;
  }
  if (state.recoveryNotifiedForModel === state.originalModel)
    return;
  logger.info("recovery.available", {
    sessionId,
    originalModel: state.originalModel,
    currentModel: state.currentModel
  });
  await notifyRecovery(client, state.originalModel);
  state.recoveryNotifiedForModel = state.originalModel;
}
function getLastUserModelAndAgent2(data) {
  if (!Array.isArray(data))
    return null;
  for (let i2 = data.length - 1;i2 >= 0; i2--) {
    const entry = data[i2];
    if (!entry || typeof entry !== "object")
      continue;
    const info = entry.info;
    if (!info || typeof info !== "object")
      continue;
    const role = info.role;
    if (role !== "user")
      continue;
    const modelKey2 = getMessageModelKey(info);
    if (!modelKey2)
      continue;
    const agent = info.agent;
    return {
      modelKey: modelKey2,
      agentName: typeof agent === "string" ? agent : null,
      source: "user"
    };
  }
  return null;
}
function getLastAssistantModelAndAgent2(data) {
  if (!Array.isArray(data))
    return null;
  for (let i2 = data.length - 1;i2 >= 0; i2--) {
    const entry = data[i2];
    if (!entry || typeof entry !== "object")
      continue;
    const info = entry.info;
    if (!info || typeof info !== "object")
      continue;
    const role = info.role;
    if (role !== "assistant")
      continue;
    const modelKey2 = getMessageModelKey(info);
    if (!modelKey2)
      continue;
    const agent = info.agent;
    if (typeof agent !== "string")
      continue;
    return {
      modelKey: modelKey2,
      agentName: agent,
      source: "assistant"
    };
  }
  return null;
}
function getMessageModelKey(info) {
  const model = info.model;
  if (model && typeof model === "object") {
    const providerID2 = model.providerID;
    const modelID2 = model.modelID;
    if (typeof providerID2 === "string" && typeof modelID2 === "string")
      return `${providerID2}/${modelID2}`;
  }
  const providerID = info.providerID;
  const modelID = info.modelID;
  if (typeof providerID === "string" && typeof modelID === "string")
    return `${providerID}/${modelID}`;
  return null;
}
export {
  createPlugin
};
