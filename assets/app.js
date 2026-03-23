// node_modules/vibinet/dist/index.js
var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
var MAX_SAFE_BITS = 53;
var text_decoder = new TextDecoder();
var union_cache = /* @__PURE__ */ new WeakMap();
var struct_cache = /* @__PURE__ */ new WeakMap();
var BitWriter = class {
  constructor(buf) {
    __publicField(this, "buf");
    __publicField(this, "bit_pos");
    this.buf = buf;
    this.bit_pos = 0;
  }
  write_bit(bit) {
    const byte_index = this.bit_pos >>> 3;
    const bit_index = this.bit_pos & 7;
    if (bit) {
      this.buf[byte_index] |= 1 << bit_index;
    }
    this.bit_pos++;
  }
  write_bitsUnsigned(value, bits) {
    if (bits === 0) return;
    if (typeof value === "number") {
      if (bits <= 32) {
        const aligned = (this.bit_pos & 7) === 0 && (bits & 7) === 0;
        if (aligned) {
          let v2 = value >>> 0;
          let byte_index = this.bit_pos >>> 3;
          for (let i = 0; i < bits; i += 8) {
            this.buf[byte_index++] = v2 & 255;
            v2 >>>= 8;
          }
          this.bit_pos += bits;
          return;
        }
        let v = value >>> 0;
        for (let i = 0; i < bits; i++) {
          this.write_bit(v & 1);
          v >>>= 1;
        }
        return;
      }
      this.write_bitsBigint(BigInt(value), bits);
      return;
    }
    this.write_bitsBigint(value, bits);
  }
  write_bitsBigint(value, bits) {
    if (bits === 0) return;
    const aligned = (this.bit_pos & 7) === 0 && (bits & 7) === 0;
    if (aligned) {
      let v2 = value;
      let byte_index = this.bit_pos >>> 3;
      for (let i = 0; i < bits; i += 8) {
        this.buf[byte_index++] = Number(v2 & 0xffn);
        v2 >>= 8n;
      }
      this.bit_pos += bits;
      return;
    }
    let v = value;
    for (let i = 0; i < bits; i++) {
      this.write_bit((v & 1n) === 0n ? 0 : 1);
      v >>= 1n;
    }
  }
};
var BitReader = class {
  constructor(buf) {
    __publicField(this, "buf");
    __publicField(this, "bit_pos");
    this.buf = buf;
    this.bit_pos = 0;
  }
  read_bit() {
    const byte_index = this.bit_pos >>> 3;
    const bit_index = this.bit_pos & 7;
    const bit = this.buf[byte_index] >>> bit_index & 1;
    this.bit_pos++;
    return bit;
  }
  read_bitsUnsigned(bits) {
    if (bits === 0) return 0;
    if (bits <= 32) {
      const aligned = (this.bit_pos & 7) === 0 && (bits & 7) === 0;
      if (aligned) {
        let v2 = 0;
        let shift = 0;
        let byte_index = this.bit_pos >>> 3;
        for (let i = 0; i < bits; i += 8) {
          v2 |= this.buf[byte_index++] << shift;
          shift += 8;
        }
        this.bit_pos += bits;
        return v2 >>> 0;
      }
      let v = 0;
      for (let i = 0; i < bits; i++) {
        if (this.read_bit()) {
          v |= 1 << i;
        }
      }
      return v >>> 0;
    }
    if (bits <= MAX_SAFE_BITS) {
      let v = 0;
      let pow = 1;
      for (let i = 0; i < bits; i++) {
        if (this.read_bit()) {
          v += pow;
        }
        pow *= 2;
      }
      return v;
    }
    return this.read_bitsBigint(bits);
  }
  read_bitsBigint(bits) {
    if (bits === 0) return 0n;
    const aligned = (this.bit_pos & 7) === 0 && (bits & 7) === 0;
    if (aligned) {
      let v2 = 0n;
      let shift = 0n;
      let byte_index = this.bit_pos >>> 3;
      for (let i = 0; i < bits; i += 8) {
        v2 |= BigInt(this.buf[byte_index++]) << shift;
        shift += 8n;
      }
      this.bit_pos += bits;
      return v2;
    }
    let v = 0n;
    let pow = 1n;
    for (let i = 0; i < bits; i++) {
      if (this.read_bit()) {
        v += pow;
      }
      pow <<= 1n;
    }
    return v;
  }
};
function assert_integer(value, name) {
  if (!Number.isInteger(value)) {
    throw new TypeError(`${name} must be an integer`);
  }
}
function assert_size(size) {
  assert_integer(size, "size");
  if (size < 0) throw new RangeError("size must be >= 0");
}
function assert_vector_size(expected, actual) {
  if (actual !== expected) {
    throw new RangeError(`vector size mismatch: expected ${expected}, got ${actual}`);
  }
}
function size_bits(type, val) {
  switch (type.$) {
    case "UInt":
    case "Int":
      assert_size(type.size);
      return type.size;
    case "Nat": {
      if (typeof val === "bigint") {
        if (val < 0n) throw new RangeError("Nat must be >= 0");
        if (val > BigInt(Number.MAX_SAFE_INTEGER)) {
          throw new RangeError("Nat too large to size");
        }
        return Number(val) + 1;
      }
      assert_integer(val, "Nat");
      if (val < 0) throw new RangeError("Nat must be >= 0");
      return val + 1;
    }
    case "Tuple": {
      const fields = type.fields;
      const arr = as_array(val, "Tuple");
      let bits = 0;
      for (let i = 0; i < fields.length; i++) {
        bits += size_bits(fields[i], arr[i]);
      }
      return bits;
    }
    case "Vector": {
      assert_size(type.size);
      const arr = as_array(val, "Vector");
      assert_vector_size(type.size, arr.length);
      let bits = 0;
      for (let i = 0; i < type.size; i++) {
        bits += size_bits(type.type, arr[i]);
      }
      return bits;
    }
    case "Struct": {
      let bits = 0;
      const keys = struct_keys(type.fields);
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        const v = get_struct_field(val, key);
        bits += size_bits(type.fields[key], v);
      }
      return bits;
    }
    case "List": {
      let bits = 1;
      for_each_list(val, (item) => {
        bits += 1;
        bits += size_bits(type.type, item);
      });
      return bits;
    }
    case "Map": {
      let bits = 1;
      for_each_map(val, (k, v) => {
        bits += 1;
        bits += size_bits(type.key, k);
        bits += size_bits(type.value, v);
      });
      return bits;
    }
    case "Union": {
      const info = union_info(type);
      const tag = get_union_tag(val);
      const variant_type = type.variants[tag];
      if (!variant_type) {
        throw new RangeError(`Unknown union variant: ${tag}`);
      }
      const payload = get_union_payload(val, variant_type);
      return info.tag_bits + size_bits(variant_type, payload);
    }
    case "String": {
      const byte_len = utf8_byte_length(val);
      return 1 + byte_len * 9;
    }
  }
}
function encode_into(writer, type, val) {
  switch (type.$) {
    case "UInt": {
      assert_size(type.size);
      if (type.size === 0) {
        if (val === 0 || val === 0n) return;
        throw new RangeError("UInt out of range");
      }
      if (typeof val === "bigint") {
        if (val < 0n) throw new RangeError("UInt must be >= 0");
        const max2 = 1n << BigInt(type.size);
        if (val >= max2) throw new RangeError("UInt out of range");
        writer.write_bitsUnsigned(val, type.size);
        return;
      }
      assert_integer(val, "UInt");
      if (val < 0) throw new RangeError("UInt must be >= 0");
      if (type.size > MAX_SAFE_BITS) {
        throw new RangeError("UInt too large for number; use bigint");
      }
      const max = 2 ** type.size;
      if (val >= max) throw new RangeError("UInt out of range");
      writer.write_bitsUnsigned(val, type.size);
      return;
    }
    case "Int": {
      assert_size(type.size);
      if (type.size === 0) {
        if (val === 0 || val === 0n) return;
        throw new RangeError("Int out of range");
      }
      if (typeof val === "bigint") {
        const size = BigInt(type.size);
        const min2 = -(1n << size - 1n);
        const max2 = (1n << size - 1n) - 1n;
        if (val < min2 || val > max2) throw new RangeError("Int out of range");
        let unsigned2 = val;
        if (val < 0n) unsigned2 = (1n << size) + val;
        writer.write_bitsUnsigned(unsigned2, type.size);
        return;
      }
      assert_integer(val, "Int");
      if (type.size > MAX_SAFE_BITS) {
        throw new RangeError("Int too large for number; use bigint");
      }
      const min = -(2 ** (type.size - 1));
      const max = 2 ** (type.size - 1) - 1;
      if (val < min || val > max) throw new RangeError("Int out of range");
      let unsigned = val;
      if (val < 0) unsigned = 2 ** type.size + val;
      writer.write_bitsUnsigned(unsigned, type.size);
      return;
    }
    case "Nat": {
      if (typeof val === "bigint") {
        if (val < 0n) throw new RangeError("Nat must be >= 0");
        let n = val;
        while (n > 0n) {
          writer.write_bit(1);
          n -= 1n;
        }
        writer.write_bit(0);
        return;
      }
      assert_integer(val, "Nat");
      if (val < 0) throw new RangeError("Nat must be >= 0");
      for (let i = 0; i < val; i++) {
        writer.write_bit(1);
      }
      writer.write_bit(0);
      return;
    }
    case "Tuple": {
      const fields = type.fields;
      const arr = as_array(val, "Tuple");
      for (let i = 0; i < fields.length; i++) {
        encode_into(writer, fields[i], arr[i]);
      }
      return;
    }
    case "Vector": {
      assert_size(type.size);
      const arr = as_array(val, "Vector");
      assert_vector_size(type.size, arr.length);
      for (let i = 0; i < type.size; i++) {
        encode_into(writer, type.type, arr[i]);
      }
      return;
    }
    case "Struct": {
      const keys = struct_keys(type.fields);
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        encode_into(writer, type.fields[key], get_struct_field(val, key));
      }
      return;
    }
    case "List": {
      for_each_list(val, (item) => {
        writer.write_bit(1);
        encode_into(writer, type.type, item);
      });
      writer.write_bit(0);
      return;
    }
    case "Map": {
      for_each_map(val, (k, v) => {
        writer.write_bit(1);
        encode_into(writer, type.key, k);
        encode_into(writer, type.value, v);
      });
      writer.write_bit(0);
      return;
    }
    case "Union": {
      const info = union_info(type);
      const tag = get_union_tag(val);
      const index = info.index_by_tag.get(tag);
      if (index === void 0) {
        throw new RangeError(`Unknown union variant: ${tag}`);
      }
      if (info.tag_bits > 0) {
        writer.write_bitsUnsigned(index, info.tag_bits);
      }
      const variant_type = type.variants[tag];
      const payload = get_union_payload(val, variant_type);
      encode_into(writer, variant_type, payload);
      return;
    }
    case "String": {
      write_utf8_list(writer, val);
      return;
    }
  }
}
function decode_from(reader, type) {
  switch (type.$) {
    case "UInt": {
      assert_size(type.size);
      return reader.read_bitsUnsigned(type.size);
    }
    case "Int": {
      assert_size(type.size);
      if (type.size === 0) return 0;
      const unsigned = reader.read_bitsUnsigned(type.size);
      if (typeof unsigned === "bigint") {
        const sign_bit2 = 1n << BigInt(type.size - 1);
        if (unsigned & sign_bit2) {
          return unsigned - (1n << BigInt(type.size));
        }
        return unsigned;
      }
      const sign_bit = 2 ** (type.size - 1);
      if (unsigned >= sign_bit) {
        return unsigned - 2 ** type.size;
      }
      return unsigned;
    }
    case "Nat": {
      let n = 0;
      let big = null;
      while (reader.read_bit()) {
        if (big !== null) {
          big += 1n;
        } else if (n === Number.MAX_SAFE_INTEGER) {
          big = BigInt(n) + 1n;
        } else {
          n++;
        }
      }
      return big ?? n;
    }
    case "Tuple": {
      const out = new Array(type.fields.length);
      for (let i = 0; i < type.fields.length; i++) {
        out[i] = decode_from(reader, type.fields[i]);
      }
      return out;
    }
    case "Vector": {
      const out = new Array(type.size);
      for (let i = 0; i < type.size; i++) {
        out[i] = decode_from(reader, type.type);
      }
      return out;
    }
    case "Struct": {
      const out = {};
      const keys = struct_keys(type.fields);
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        out[key] = decode_from(reader, type.fields[key]);
      }
      return out;
    }
    case "List": {
      const out = [];
      while (reader.read_bit()) {
        out.push(decode_from(reader, type.type));
      }
      return out;
    }
    case "Map": {
      const out = /* @__PURE__ */ new Map();
      while (reader.read_bit()) {
        const key = decode_from(reader, type.key);
        const value = decode_from(reader, type.value);
        out.set(key, value);
      }
      return out;
    }
    case "Union": {
      const info = union_info(type);
      let raw_index = 0;
      if (info.tag_bits > 0) {
        raw_index = reader.read_bitsUnsigned(info.tag_bits);
      }
      let index;
      if (typeof raw_index === "bigint") {
        if (raw_index > BigInt(Number.MAX_SAFE_INTEGER)) {
          throw new RangeError("Union tag index too large");
        }
        index = Number(raw_index);
      } else {
        index = raw_index;
      }
      if (index < 0 || index >= info.keys.length) {
        throw new RangeError("Union tag index out of range");
      }
      const tag = info.keys[index];
      const variant_type = type.variants[tag];
      const payload = decode_from(reader, variant_type);
      if (variant_type.$ === "Struct") {
        if (payload && typeof payload === "object") {
          payload.$ = tag;
          return payload;
        }
      }
      return { $: tag, value: payload };
    }
    case "String": {
      return read_utf8_list(reader);
    }
  }
}
function as_array(val, label) {
  if (!Array.isArray(val)) {
    throw new TypeError(`${label} value must be an Array`);
  }
  return val;
}
function get_struct_field(val, key) {
  if (val && typeof val === "object") {
    return val[key];
  }
  throw new TypeError("Struct value must be an object");
}
function union_info(type) {
  const cached = union_cache.get(type);
  if (cached) return cached;
  const keys = Object.keys(type.variants).sort();
  if (keys.length === 0) {
    throw new RangeError("Union must have at least one variant");
  }
  const index_by_tag = /* @__PURE__ */ new Map();
  for (let i = 0; i < keys.length; i++) {
    index_by_tag.set(keys[i], i);
  }
  const tag_bits = keys.length <= 1 ? 0 : Math.ceil(Math.log2(keys.length));
  const info = { keys, index_by_tag, tag_bits };
  union_cache.set(type, info);
  return info;
}
function struct_keys(fields) {
  const cached = struct_cache.get(fields);
  if (cached) return cached;
  const keys = Object.keys(fields);
  struct_cache.set(fields, keys);
  return keys;
}
function get_union_tag(val) {
  if (!val || typeof val !== "object") {
    throw new TypeError("Union value must be an object with a $ tag");
  }
  const tag = val.$;
  if (typeof tag !== "string") {
    throw new TypeError("Union value must have a string $ tag");
  }
  return tag;
}
function get_union_payload(val, variant_type) {
  if (variant_type.$ !== "Struct" && val && typeof val === "object" && Object.prototype.hasOwnProperty.call(val, "value")) {
    return val.value;
  }
  return val;
}
function for_each_list(val, fn) {
  if (!Array.isArray(val)) {
    throw new TypeError("List value must be an Array");
  }
  for (let i = 0; i < val.length; i++) {
    fn(val[i]);
  }
}
function for_each_map(val, fn) {
  if (val == null) return;
  if (val instanceof Map) {
    for (const [k, v] of val) {
      fn(k, v);
    }
    return;
  }
  if (typeof val === "object") {
    for (const key of Object.keys(val)) {
      fn(key, val[key]);
    }
    return;
  }
  throw new TypeError("Map value must be a Map or object");
}
function utf8_byte_length(value) {
  if (typeof value !== "string") {
    throw new TypeError("String value must be a string");
  }
  let len = 0;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 128) {
      len += 1;
    } else if (code < 2048) {
      len += 2;
    } else if (code >= 55296 && code <= 56319) {
      const next = i + 1 < value.length ? value.charCodeAt(i + 1) : 0;
      if (next >= 56320 && next <= 57343) {
        i++;
        len += 4;
      } else {
        len += 3;
      }
    } else if (code >= 56320 && code <= 57343) {
      len += 3;
    } else {
      len += 3;
    }
  }
  return len;
}
function write_utf8_list(writer, value) {
  if (typeof value !== "string") {
    throw new TypeError("String value must be a string");
  }
  for (let i = 0; i < value.length; i++) {
    let code = value.charCodeAt(i);
    if (code < 128) {
      writer.write_bit(1);
      writer.write_bitsUnsigned(code, 8);
      continue;
    }
    if (code < 2048) {
      writer.write_bit(1);
      writer.write_bitsUnsigned(192 | code >>> 6, 8);
      writer.write_bit(1);
      writer.write_bitsUnsigned(128 | code & 63, 8);
      continue;
    }
    if (code >= 55296 && code <= 56319) {
      const next = i + 1 < value.length ? value.charCodeAt(i + 1) : 0;
      if (next >= 56320 && next <= 57343) {
        i++;
        const cp = (code - 55296 << 10) + (next - 56320) + 65536;
        writer.write_bit(1);
        writer.write_bitsUnsigned(240 | cp >>> 18, 8);
        writer.write_bit(1);
        writer.write_bitsUnsigned(128 | cp >>> 12 & 63, 8);
        writer.write_bit(1);
        writer.write_bitsUnsigned(128 | cp >>> 6 & 63, 8);
        writer.write_bit(1);
        writer.write_bitsUnsigned(128 | cp & 63, 8);
        continue;
      }
      code = 65533;
    } else if (code >= 56320 && code <= 57343) {
      code = 65533;
    }
    writer.write_bit(1);
    writer.write_bitsUnsigned(224 | code >>> 12, 8);
    writer.write_bit(1);
    writer.write_bitsUnsigned(128 | code >>> 6 & 63, 8);
    writer.write_bit(1);
    writer.write_bitsUnsigned(128 | code & 63, 8);
  }
  writer.write_bit(0);
}
function read_utf8_list(reader) {
  let bytes = new Uint8Array(16);
  let len = 0;
  while (reader.read_bit()) {
    const byte = reader.read_bitsUnsigned(8);
    if (len === bytes.length) {
      const next = new Uint8Array(bytes.length * 2);
      next.set(bytes);
      bytes = next;
    }
    bytes[len++] = byte;
  }
  return text_decoder.decode(bytes.subarray(0, len));
}
function encode(type, val) {
  const bits = size_bits(type, val);
  const buf = new Uint8Array(bits + 7 >>> 3);
  const writer = new BitWriter(buf);
  encode_into(writer, type, val);
  return buf;
}
function decode(type, buf) {
  const reader = new BitReader(buf);
  return decode_from(reader, type);
}
var TIME_BITS = 53;
var BYTE_LIST_PACKED = { $: "List", type: { $: "UInt", size: 8 } };
var MESSAGE_PACKED = {
  $: "Union",
  variants: {
    get_time: { $: "Struct", fields: {} },
    info_time: {
      $: "Struct",
      fields: {
        time: { $: "UInt", size: TIME_BITS }
      }
    },
    post: {
      $: "Struct",
      fields: {
        room: { $: "String" },
        time: { $: "UInt", size: TIME_BITS },
        name: { $: "String" },
        payload: BYTE_LIST_PACKED
      }
    },
    info_post: {
      $: "Struct",
      fields: {
        room: { $: "String" },
        index: { $: "UInt", size: 32 },
        server_time: { $: "UInt", size: TIME_BITS },
        client_time: { $: "UInt", size: TIME_BITS },
        name: { $: "String" },
        payload: BYTE_LIST_PACKED
      }
    },
    load: {
      $: "Struct",
      fields: {
        room: { $: "String" },
        from: { $: "UInt", size: 32 }
      }
    },
    watch: {
      $: "Struct",
      fields: {
        room: { $: "String" }
      }
    },
    unwatch: {
      $: "Struct",
      fields: {
        room: { $: "String" }
      }
    },
    get_latest_post_index: {
      $: "Struct",
      fields: {
        room: { $: "String" }
      }
    },
    info_latest_post_index: {
      $: "Struct",
      fields: {
        room: { $: "String" },
        latest_index: { $: "Int", size: 32 },
        server_time: { $: "UInt", size: TIME_BITS }
      }
    }
  }
};
function bytes_to_list(bytes) {
  const out = new Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    out[i] = bytes[i];
  }
  return out;
}
function list_to_bytes(list) {
  const out = new Uint8Array(list.length);
  for (let i = 0; i < list.length; i++) {
    out[i] = list[i] & 255;
  }
  return out;
}
function to_wire_message(message) {
  switch (message.$) {
    case "post":
      return {
        $: "post",
        room: message.room,
        time: message.time,
        name: message.name,
        payload: bytes_to_list(message.payload)
      };
    case "info_post":
      return {
        $: "info_post",
        room: message.room,
        index: message.index,
        server_time: message.server_time,
        client_time: message.client_time,
        name: message.name,
        payload: bytes_to_list(message.payload)
      };
    default:
      return message;
  }
}
function from_wire_message(message) {
  switch (message.$) {
    case "post":
      return {
        $: "post",
        room: message.room,
        time: message.time,
        name: message.name,
        payload: list_to_bytes(message.payload)
      };
    case "info_post":
      return {
        $: "info_post",
        room: message.room,
        index: message.index,
        server_time: message.server_time,
        client_time: message.client_time,
        name: message.name,
        payload: list_to_bytes(message.payload)
      };
    default:
      return message;
  }
}
function encode_message(message) {
  return encode(MESSAGE_PACKED, to_wire_message(message));
}
function decode_message(buf) {
  const message = decode(MESSAGE_PACKED, buf);
  return from_wire_message(message);
}
var OFFICIAL_SERVER_URL = "wss://net.studiovibi.com";
function normalize_ws_url(raw_url) {
  let ws_url = raw_url;
  try {
    const url = new URL(raw_url);
    if (url.protocol === "http:") {
      url.protocol = "ws:";
    } else if (url.protocol === "https:") {
      url.protocol = "wss:";
    }
    ws_url = url.toString();
  } catch {
    ws_url = raw_url;
  }
  if (typeof window !== "undefined" && window.location.protocol === "https:" && ws_url.startsWith("ws://")) {
    const upgraded = `wss://${ws_url.slice("ws://".length)}`;
    console.warn(
      `[VibiNet] Upgrading insecure WebSocket URL "${ws_url}" to "${upgraded}" because the page is HTTPS.`
    );
    return upgraded;
  }
  return ws_url;
}
function now() {
  return Math.floor(Date.now());
}
function default_ws_url() {
  return OFFICIAL_SERVER_URL;
}
function gen_name() {
  const alphabet = "_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-";
  const bytes = new Uint8Array(8);
  const can_crypto = typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function";
  if (can_crypto) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 8; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  let out = "";
  for (let i = 0; i < 8; i++) {
    out += alphabet[bytes[i] % 64];
  }
  return out;
}
function create_client(server) {
  const time_sync = {
    clock_offset: Infinity,
    lowest_ping: Infinity,
    request_sent_at: 0,
    last_ping: Infinity
  };
  const room_watchers = /* @__PURE__ */ new Map();
  const watched_rooms = /* @__PURE__ */ new Set();
  const latest_post_index_listeners = [];
  let is_synced = false;
  const sync_listeners = [];
  let heartbeat_id = null;
  let reconnect_timer_id = null;
  let reconnect_attempt = 0;
  let manual_close = false;
  let ws = null;
  const pending_posts = [];
  const ws_url = normalize_ws_url(server ?? default_ws_url());
  function server_time() {
    if (!isFinite(time_sync.clock_offset)) {
      throw new Error("server_time() called before initial sync");
    }
    return Math.floor(now() + time_sync.clock_offset);
  }
  function clear_heartbeat() {
    if (heartbeat_id !== null) {
      clearInterval(heartbeat_id);
      heartbeat_id = null;
    }
  }
  function clear_reconnect_timer() {
    if (reconnect_timer_id !== null) {
      clearTimeout(reconnect_timer_id);
      reconnect_timer_id = null;
    }
  }
  function reconnect_delay_ms() {
    const base = 500;
    const cap = 8e3;
    const expo = Math.min(cap, base * Math.pow(2, reconnect_attempt));
    const jitter = Math.floor(Math.random() * 250);
    return expo + jitter;
  }
  function flush_pending_posts_if_open() {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return;
    }
    while (pending_posts.length > 0) {
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        return;
      }
      const next = pending_posts[0];
      try {
        ws.send(next);
        pending_posts.shift();
      } catch {
        connect();
        return;
      }
    }
  }
  function send_time_request_if_open() {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return;
    }
    time_sync.request_sent_at = now();
    ws.send(encode_message({ $: "get_time" }));
  }
  function try_send(buf) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return false;
    }
    try {
      ws.send(buf);
      return true;
    } catch {
      return false;
    }
  }
  function send_or_reconnect(buf) {
    if (try_send(buf)) {
      return;
    }
    connect();
  }
  function queue_post(buf) {
    pending_posts.push(buf);
    connect();
  }
  function register_handler(room, packer, handler) {
    const existing = room_watchers.get(room);
    if (existing) {
      if (existing.packer !== packer) {
        throw new Error(`Packed schema already registered for room: ${room}`);
      }
      if (handler) {
        existing.handler = handler;
      }
      return;
    }
    room_watchers.set(room, { handler, packer });
  }
  function schedule_reconnect() {
    if (manual_close || reconnect_timer_id !== null) {
      return;
    }
    const delay = reconnect_delay_ms();
    reconnect_timer_id = setTimeout(() => {
      reconnect_timer_id = null;
      reconnect_attempt += 1;
      connect();
    }, delay);
  }
  function connect() {
    if (manual_close) {
      return;
    }
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    clear_reconnect_timer();
    const socket = new WebSocket(ws_url);
    ws = socket;
    socket.binaryType = "arraybuffer";
    socket.addEventListener("open", () => {
      if (ws !== socket) {
        return;
      }
      reconnect_attempt = 0;
      console.log("[WS] Connected");
      send_time_request_if_open();
      clear_heartbeat();
      for (const room of watched_rooms.values()) {
        socket.send(encode_message({ $: "watch", room }));
      }
      flush_pending_posts_if_open();
      heartbeat_id = setInterval(send_time_request_if_open, 2e3);
    });
    socket.addEventListener("message", (event) => {
      const data = event.data instanceof ArrayBuffer ? new Uint8Array(event.data) : new Uint8Array(event.data);
      const msg = decode_message(data);
      switch (msg.$) {
        case "info_time": {
          const t = now();
          const ping = t - time_sync.request_sent_at;
          time_sync.last_ping = ping;
          if (ping < time_sync.lowest_ping) {
            const local_avg = Math.floor((time_sync.request_sent_at + t) / 2);
            time_sync.clock_offset = msg.time - local_avg;
            time_sync.lowest_ping = ping;
          }
          if (!is_synced) {
            is_synced = true;
            for (const cb of sync_listeners) {
              cb();
            }
            sync_listeners.length = 0;
          }
          break;
        }
        case "info_post": {
          const watcher = room_watchers.get(msg.room);
          if (watcher && watcher.handler) {
            const data2 = decode(watcher.packer, msg.payload);
            watcher.handler({
              $: "info_post",
              room: msg.room,
              index: msg.index,
              server_time: msg.server_time,
              client_time: msg.client_time,
              name: msg.name,
              data: data2
            });
          }
          break;
        }
        case "info_latest_post_index": {
          for (const cb of latest_post_index_listeners) {
            cb({
              room: msg.room,
              latest_index: msg.latest_index,
              server_time: msg.server_time
            });
          }
          break;
        }
      }
    });
    socket.addEventListener("close", (event) => {
      if (ws !== socket) {
        return;
      }
      clear_heartbeat();
      ws = null;
      if (manual_close) {
        return;
      }
      console.warn(`[WS] Disconnected (code=${event.code}); reconnecting...`);
      schedule_reconnect();
    });
    socket.addEventListener("error", () => {
    });
  }
  connect();
  return {
    on_sync: (callback) => {
      if (is_synced) {
        callback();
        return;
      }
      sync_listeners.push(callback);
    },
    watch: (room, packer, handler) => {
      register_handler(room, packer, handler);
      watched_rooms.add(room);
      send_or_reconnect(encode_message({ $: "watch", room }));
    },
    load: (room, from, packer, handler) => {
      register_handler(room, packer, handler);
      send_or_reconnect(encode_message({ $: "load", room, from }));
    },
    get_latest_post_index: (room) => {
      send_or_reconnect(encode_message({ $: "get_latest_post_index", room }));
    },
    on_latest_post_index: (callback) => {
      latest_post_index_listeners.push(callback);
    },
    post: (room, data, packer) => {
      const name = gen_name();
      const payload = encode(packer, data);
      const message = encode_message({ $: "post", room, time: server_time(), name, payload });
      if (pending_posts.length > 0) {
        flush_pending_posts_if_open();
      }
      if (!try_send(message)) {
        queue_post(message);
      }
      return name;
    },
    server_time,
    ping: () => time_sync.last_ping,
    close: () => {
      manual_close = true;
      clear_reconnect_timer();
      clear_heartbeat();
      if (ws && ws.readyState === WebSocket.OPEN) {
        for (const room of watched_rooms.values()) {
          try {
            ws.send(encode_message({ $: "unwatch", room }));
          } catch {
            break;
          }
        }
      }
      if (ws) {
        ws.close();
      }
      ws = null;
    },
    debug_dump: () => ({
      ws_url,
      ws_ready_state: ws ? ws.readyState : WebSocket.CLOSED,
      is_synced,
      reconnect_attempt,
      reconnect_scheduled: reconnect_timer_id !== null,
      pending_post_count: pending_posts.length,
      watched_rooms: Array.from(watched_rooms.values()),
      room_watchers: Array.from(room_watchers.keys()),
      room_watcher_count: room_watchers.size,
      latest_post_index_listener_count: latest_post_index_listeners.length,
      sync_listener_count: sync_listeners.length,
      time_sync: {
        clock_offset: time_sync.clock_offset,
        lowest_ping: time_sync.lowest_ping,
        request_sent_at: time_sync.request_sent_at,
        last_ping: time_sync.last_ping
      }
    })
  };
}
var _VibiNet = class _VibiNet2 {
  // Create a VibiNet instance and hook the client sync/load/watch callbacks.
  constructor(options) {
    __publicField(this, "room");
    __publicField(this, "init");
    __publicField(this, "on_tick");
    __publicField(this, "on_post");
    __publicField(this, "packer");
    __publicField(this, "smooth");
    __publicField(this, "tick_rate");
    __publicField(this, "tolerance");
    __publicField(this, "client_api");
    __publicField(this, "remote_posts");
    __publicField(this, "local_posts");
    __publicField(this, "timeline");
    __publicField(this, "cache_enabled");
    __publicField(this, "snapshot_stride");
    __publicField(this, "snapshot_count");
    __publicField(this, "snapshots");
    __publicField(this, "snapshot_start_tick");
    __publicField(this, "initial_time_value");
    __publicField(this, "initial_tick_value");
    __publicField(this, "no_pending_posts_before_ms");
    __publicField(this, "max_contiguous_remote_index");
    __publicField(this, "cache_drop_guard_hits");
    __publicField(this, "latest_index_poll_interval_id");
    __publicField(this, "max_remote_index");
    const default_smooth = (remote, _local) => remote;
    const smooth = options.smooth ?? default_smooth;
    const cache = options.cache ?? true;
    const snapshot_stride = options.snapshot_stride ?? 8;
    const snapshot_count = options.snapshot_count ?? 256;
    const client_api = options.client ?? create_client(options.server);
    this.room = options.room;
    this.init = options.initial;
    this.on_tick = options.on_tick;
    this.on_post = options.on_post;
    this.packer = options.packer;
    this.smooth = smooth;
    this.tick_rate = options.tick_rate;
    this.tolerance = options.tolerance;
    this.client_api = client_api;
    this.remote_posts = /* @__PURE__ */ new Map();
    this.local_posts = /* @__PURE__ */ new Map();
    this.timeline = /* @__PURE__ */ new Map();
    this.cache_enabled = cache;
    this.snapshot_stride = Math.max(1, Math.floor(snapshot_stride));
    this.snapshot_count = Math.max(1, Math.floor(snapshot_count));
    this.snapshots = /* @__PURE__ */ new Map();
    this.snapshot_start_tick = null;
    this.initial_time_value = null;
    this.initial_tick_value = null;
    this.no_pending_posts_before_ms = null;
    this.max_contiguous_remote_index = -1;
    this.cache_drop_guard_hits = 0;
    this.latest_index_poll_interval_id = null;
    this.max_remote_index = -1;
    if (this.client_api.on_latest_post_index) {
      this.client_api.on_latest_post_index((info) => {
        this.on_latest_post_index_info(info);
      });
    }
    this.client_api.on_sync(() => {
      console.log(`[VIBI] synced; loading+watching room=${this.room}`);
      const on_info_post = (post) => {
        if (post.name) {
          this.remove_local_post(post.name);
        }
        this.add_remote_post(post);
      };
      this.client_api.load(this.room, 0, this.packer, on_info_post);
      this.client_api.watch(this.room, this.packer, on_info_post);
      this.request_latest_post_index();
      if (this.latest_index_poll_interval_id !== null) {
        clearInterval(this.latest_index_poll_interval_id);
      }
      this.latest_index_poll_interval_id = setInterval(() => {
        this.request_latest_post_index();
      }, 2e3);
    });
  }
  // Compute the authoritative time a post takes effect.
  official_time(post) {
    if (post.client_time <= post.server_time - this.tolerance) {
      return post.server_time - this.tolerance;
    } else {
      return post.client_time;
    }
  }
  // Convert a post into its authoritative tick.
  official_tick(post) {
    return this.time_to_tick(this.official_time(post));
  }
  // Get or create the timeline bucket for a tick.
  get_bucket(tick) {
    let bucket = this.timeline.get(tick);
    if (!bucket) {
      bucket = { remote: [], local: [] };
      this.timeline.set(tick, bucket);
    }
    return bucket;
  }
  // Insert an authoritative post into a tick bucket (kept sorted by index).
  insert_remote_post(post, tick) {
    const bucket = this.get_bucket(tick);
    bucket.remote.push(post);
    bucket.remote.sort((a, b) => a.index - b.index);
  }
  // Drop snapshots at or after tick; earlier snapshots remain valid.
  invalidate_from_tick(tick) {
    if (!this.cache_enabled) {
      return;
    }
    const start_tick = this.snapshot_start_tick;
    if (start_tick !== null && tick < start_tick) {
      return;
    }
    if (start_tick === null || this.snapshots.size === 0) {
      return;
    }
    const stride = this.snapshot_stride;
    const end_tick = start_tick + (this.snapshots.size - 1) * stride;
    if (tick > end_tick) {
      return;
    }
    if (tick <= start_tick) {
      this.snapshots.clear();
      return;
    }
    for (let t = end_tick; t >= tick; t -= stride) {
      this.snapshots.delete(t);
    }
  }
  // Apply on_tick/on_post from (from_tick, to_tick] to advance a state.
  advance_state(state, from_tick, to_tick) {
    let next = state;
    for (let tick = from_tick + 1; tick <= to_tick; tick++) {
      next = this.apply_tick(next, tick);
    }
    return next;
  }
  // Drop all cached timeline/post data older than prune_tick.
  prune_before_tick(prune_tick) {
    if (!this.cache_enabled) {
      return;
    }
    const safe_prune_tick = this.safe_prune_tick();
    if (safe_prune_tick !== null && prune_tick > safe_prune_tick) {
      this.cache_drop_guard_hits += 1;
      prune_tick = safe_prune_tick;
    }
    for (const tick of this.timeline.keys()) {
      if (tick < prune_tick) {
        this.timeline.delete(tick);
      }
    }
    for (const [index, post] of this.remote_posts.entries()) {
      if (this.official_tick(post) < prune_tick) {
        this.remote_posts.delete(index);
      }
    }
    for (const [name, post] of this.local_posts.entries()) {
      if (this.official_tick(post) < prune_tick) {
        this.local_posts.delete(name);
      }
    }
  }
  tick_ms() {
    return 1e3 / this.tick_rate;
  }
  cache_window_ticks() {
    return this.snapshot_stride * Math.max(0, this.snapshot_count - 1);
  }
  safe_prune_tick() {
    if (this.no_pending_posts_before_ms === null) {
      return null;
    }
    return this.time_to_tick(this.no_pending_posts_before_ms);
  }
  safe_compute_tick(requested_tick) {
    if (!this.cache_enabled) {
      return requested_tick;
    }
    const safe_prune_tick = this.safe_prune_tick();
    if (safe_prune_tick === null) {
      return requested_tick;
    }
    const safe_tick = safe_prune_tick + this.cache_window_ticks();
    return Math.min(requested_tick, safe_tick);
  }
  advance_no_pending_posts_before_ms(candidate) {
    const bounded = Math.max(0, Math.floor(candidate));
    if (this.no_pending_posts_before_ms === null || bounded > this.no_pending_posts_before_ms) {
      this.no_pending_posts_before_ms = bounded;
    }
  }
  advance_contiguous_remote_frontier() {
    for (; ; ) {
      const next_index = this.max_contiguous_remote_index + 1;
      const post = this.remote_posts.get(next_index);
      if (!post) {
        break;
      }
      this.max_contiguous_remote_index = next_index;
      this.advance_no_pending_posts_before_ms(this.official_time(post));
    }
  }
  on_latest_post_index_info(info) {
    if (info.room !== this.room) {
      return;
    }
    if (info.latest_index > this.max_contiguous_remote_index) {
      return;
    }
    const conservative_margin = this.tick_ms();
    const candidate = info.server_time - this.tolerance - conservative_margin;
    this.advance_no_pending_posts_before_ms(candidate);
  }
  request_latest_post_index() {
    if (!this.client_api.get_latest_post_index) {
      return;
    }
    try {
      this.client_api.get_latest_post_index(this.room);
    } catch {
    }
  }
  // Ensure snapshots exist through at_tick, filling forward as needed.
  ensure_snapshots(at_tick, initial_tick) {
    if (!this.cache_enabled) {
      return;
    }
    if (this.snapshot_start_tick === null) {
      this.snapshot_start_tick = initial_tick;
    }
    let start_tick = this.snapshot_start_tick;
    if (start_tick === null) {
      return;
    }
    if (at_tick < start_tick) {
      return;
    }
    const stride = this.snapshot_stride;
    const target_tick = start_tick + Math.floor((at_tick - start_tick) / stride) * stride;
    let state;
    let current_tick;
    if (this.snapshots.size === 0) {
      state = this.init;
      current_tick = start_tick - 1;
    } else {
      const end_tick = start_tick + (this.snapshots.size - 1) * stride;
      state = this.snapshots.get(end_tick);
      current_tick = end_tick;
    }
    let next_tick = current_tick + stride;
    if (this.snapshots.size === 0) {
      next_tick = start_tick;
    }
    for (; next_tick <= target_tick; next_tick += stride) {
      state = this.advance_state(state, current_tick, next_tick);
      this.snapshots.set(next_tick, state);
      current_tick = next_tick;
    }
    const count = this.snapshots.size;
    if (count > this.snapshot_count) {
      const overflow = count - this.snapshot_count;
      const drop_until = start_tick + overflow * stride;
      for (let t = start_tick; t < drop_until; t += stride) {
        this.snapshots.delete(t);
      }
      start_tick = drop_until;
      this.snapshot_start_tick = start_tick;
    }
    this.prune_before_tick(start_tick);
  }
  // Add or replace an authoritative post and update the timeline.
  add_remote_post(post) {
    const tick = this.official_tick(post);
    if (post.index === 0 && this.initial_time_value === null) {
      const t = this.official_time(post);
      this.initial_time_value = t;
      this.initial_tick_value = this.time_to_tick(t);
    }
    if (this.remote_posts.has(post.index)) {
      return;
    }
    const before_window = this.cache_enabled && this.snapshot_start_tick !== null && tick < this.snapshot_start_tick;
    if (before_window) {
      this.cache_drop_guard_hits += 1;
      this.snapshots.clear();
      this.snapshot_start_tick = null;
    }
    this.remote_posts.set(post.index, post);
    if (post.index > this.max_remote_index) {
      this.max_remote_index = post.index;
    }
    this.advance_contiguous_remote_frontier();
    this.insert_remote_post(post, tick);
    this.invalidate_from_tick(tick);
  }
  // Add a local predicted post (applied after remote posts for the same tick).
  add_local_post(name, post) {
    if (this.local_posts.has(name)) {
      this.remove_local_post(name);
    }
    const tick = this.official_tick(post);
    const before_window = this.cache_enabled && this.snapshot_start_tick !== null && tick < this.snapshot_start_tick;
    if (before_window) {
      this.cache_drop_guard_hits += 1;
      this.snapshots.clear();
      this.snapshot_start_tick = null;
    }
    this.local_posts.set(name, post);
    this.get_bucket(tick).local.push(post);
    this.invalidate_from_tick(tick);
  }
  // Remove a local predicted post once the authoritative echo arrives.
  remove_local_post(name) {
    const post = this.local_posts.get(name);
    if (!post) {
      return;
    }
    this.local_posts.delete(name);
    const tick = this.official_tick(post);
    const bucket = this.timeline.get(tick);
    if (bucket) {
      const index = bucket.local.indexOf(post);
      if (index !== -1) {
        bucket.local.splice(index, 1);
      } else {
        const by_name = bucket.local.findIndex((p) => p.name === name);
        if (by_name !== -1) {
          bucket.local.splice(by_name, 1);
        }
      }
      if (bucket.remote.length === 0 && bucket.local.length === 0) {
        this.timeline.delete(tick);
      }
    }
    this.invalidate_from_tick(tick);
  }
  // Apply on_tick plus any posts for a single tick.
  apply_tick(state, tick) {
    let next = this.on_tick(state);
    const bucket = this.timeline.get(tick);
    if (bucket) {
      for (const post of bucket.remote) {
        next = this.on_post(post.data, next);
      }
      for (const post of bucket.local) {
        next = this.on_post(post.data, next);
      }
    }
    return next;
  }
  // Recompute state from scratch without caching.
  compute_state_at_uncached(initial_tick, at_tick) {
    let state = this.init;
    for (let tick = initial_tick; tick <= at_tick; tick++) {
      state = this.apply_tick(state, tick);
    }
    return state;
  }
  post_to_debug_dump(post) {
    return {
      room: post.room,
      index: post.index,
      server_time: post.server_time,
      client_time: post.client_time,
      name: post.name,
      official_time: this.official_time(post),
      official_tick: this.official_tick(post),
      data: post.data
    };
  }
  timeline_tick_bounds() {
    let min = null;
    let max = null;
    for (const tick of this.timeline.keys()) {
      if (min === null || tick < min) {
        min = tick;
      }
      if (max === null || tick > max) {
        max = tick;
      }
    }
    return { min, max };
  }
  snapshot_tick_bounds() {
    let min = null;
    let max = null;
    for (const tick of this.snapshots.keys()) {
      if (min === null || tick < min) {
        min = tick;
      }
      if (max === null || tick > max) {
        max = tick;
      }
    }
    return { min, max };
  }
  // Convert a server-time timestamp to a tick index.
  time_to_tick(server_time) {
    return Math.floor(server_time * this.tick_rate / 1e3);
  }
  // Read the synchronized server time.
  server_time() {
    return this.client_api.server_time();
  }
  // Read the current server tick.
  server_tick() {
    return this.time_to_tick(this.server_time());
  }
  // Total authoritative remote posts seen so far.
  post_count() {
    return this.max_remote_index + 1;
  }
  // Build a render state from a past (remote) tick and current (local) tick.
  compute_render_state() {
    const curr_tick = this.server_tick();
    const tick_ms = 1e3 / this.tick_rate;
    const tol_ticks = Math.ceil(this.tolerance / tick_ms);
    const rtt_ms = this.client_api.ping();
    const half_rtt = isFinite(rtt_ms) ? Math.ceil(rtt_ms / 2 / tick_ms) : 0;
    const remote_lag = Math.max(tol_ticks, half_rtt + 1);
    const remote_tick = Math.max(0, curr_tick - remote_lag);
    const remote_state = this.compute_state_at(remote_tick);
    const local_state = this.compute_state_at(curr_tick);
    return this.smooth(remote_state, local_state);
  }
  // Return the authoritative time of the first post (index 0).
  initial_time() {
    if (this.initial_time_value !== null) {
      return this.initial_time_value;
    }
    const post = this.remote_posts.get(0);
    if (!post) {
      return null;
    }
    const t = this.official_time(post);
    this.initial_time_value = t;
    this.initial_tick_value = this.time_to_tick(t);
    return t;
  }
  // Return the authoritative tick of the first post (index 0).
  initial_tick() {
    if (this.initial_tick_value !== null) {
      return this.initial_tick_value;
    }
    const t = this.initial_time();
    if (t === null) {
      return null;
    }
    this.initial_tick_value = this.time_to_tick(t);
    return this.initial_tick_value;
  }
  // Compute state at an arbitrary tick, using snapshots when enabled.
  compute_state_at(at_tick) {
    at_tick = this.safe_compute_tick(at_tick);
    const initial_tick = this.initial_tick();
    if (initial_tick === null) {
      return this.init;
    }
    if (at_tick < initial_tick) {
      return this.init;
    }
    if (!this.cache_enabled) {
      return this.compute_state_at_uncached(initial_tick, at_tick);
    }
    this.ensure_snapshots(at_tick, initial_tick);
    const start_tick = this.snapshot_start_tick;
    if (start_tick === null || this.snapshots.size === 0) {
      return this.init;
    }
    if (at_tick < start_tick) {
      return this.snapshots.get(start_tick) ?? this.init;
    }
    const stride = this.snapshot_stride;
    const end_tick = start_tick + (this.snapshots.size - 1) * stride;
    const max_index = Math.floor((end_tick - start_tick) / stride);
    const snap_index = Math.floor((at_tick - start_tick) / stride);
    const index = Math.min(snap_index, max_index);
    const snap_tick = start_tick + index * stride;
    const base_state = this.snapshots.get(snap_tick) ?? this.init;
    return this.advance_state(base_state, snap_tick, at_tick);
  }
  debug_dump() {
    const remote_posts = Array.from(this.remote_posts.values()).sort((a, b) => a.index - b.index).map((post) => this.post_to_debug_dump(post));
    const local_posts = Array.from(this.local_posts.values()).sort((a, b) => {
      const ta = this.official_tick(a);
      const tb = this.official_tick(b);
      if (ta !== tb) {
        return ta - tb;
      }
      const na = a.name ?? "";
      const nb = b.name ?? "";
      return na.localeCompare(nb);
    }).map((post) => this.post_to_debug_dump(post));
    const timeline = Array.from(this.timeline.entries()).sort((a, b) => a[0] - b[0]).map(([tick, bucket]) => ({
      tick,
      remote_count: bucket.remote.length,
      local_count: bucket.local.length,
      remote_posts: bucket.remote.map((post) => this.post_to_debug_dump(post)),
      local_posts: bucket.local.map((post) => this.post_to_debug_dump(post))
    }));
    const snapshots = Array.from(this.snapshots.entries()).sort((a, b) => a[0] - b[0]).map(([tick, state]) => ({ tick, state }));
    const initial_time = this.initial_time();
    const initial_tick = this.initial_tick();
    const timeline_bounds = this.timeline_tick_bounds();
    const snapshot_bounds = this.snapshot_tick_bounds();
    const history_truncated = initial_tick !== null && timeline_bounds.min !== null && timeline_bounds.min > initial_tick;
    let server_time = null;
    let server_tick = null;
    try {
      server_time = this.server_time();
      server_tick = this.server_tick();
    } catch {
      server_time = null;
      server_tick = null;
    }
    let min_remote_index = null;
    let max_remote_index = null;
    for (const index of this.remote_posts.keys()) {
      if (min_remote_index === null || index < min_remote_index) {
        min_remote_index = index;
      }
      if (max_remote_index === null || index > max_remote_index) {
        max_remote_index = index;
      }
    }
    const client_debug = typeof this.client_api.debug_dump === "function" ? this.client_api.debug_dump() : null;
    return {
      room: this.room,
      tick_rate: this.tick_rate,
      tolerance: this.tolerance,
      cache_enabled: this.cache_enabled,
      snapshot_stride: this.snapshot_stride,
      snapshot_count: this.snapshot_count,
      snapshot_start_tick: this.snapshot_start_tick,
      no_pending_posts_before_ms: this.no_pending_posts_before_ms,
      max_contiguous_remote_index: this.max_contiguous_remote_index,
      initial_time,
      initial_tick,
      max_remote_index: this.max_remote_index,
      post_count: this.post_count(),
      server_time,
      server_tick,
      ping: this.ping(),
      history_truncated,
      cache_drop_guard_hits: this.cache_drop_guard_hits,
      counts: {
        remote_posts: this.remote_posts.size,
        local_posts: this.local_posts.size,
        timeline_ticks: this.timeline.size,
        snapshots: this.snapshots.size
      },
      ranges: {
        timeline_min_tick: timeline_bounds.min,
        timeline_max_tick: timeline_bounds.max,
        snapshot_min_tick: snapshot_bounds.min,
        snapshot_max_tick: snapshot_bounds.max,
        min_remote_index,
        max_remote_index
      },
      remote_posts,
      local_posts,
      timeline,
      snapshots,
      client_debug
    };
  }
  debug_recompute(at_tick) {
    const initial_tick = this.initial_tick();
    const timeline_bounds = this.timeline_tick_bounds();
    const history_truncated = initial_tick !== null && timeline_bounds.min !== null && timeline_bounds.min > initial_tick;
    let target_tick = at_tick;
    if (target_tick === void 0) {
      try {
        target_tick = this.server_tick();
      } catch {
        target_tick = void 0;
      }
    }
    if (target_tick === void 0) {
      target_tick = initial_tick ?? 0;
    }
    const invalidated_snapshot_count = this.snapshots.size;
    this.snapshots.clear();
    this.snapshot_start_tick = null;
    const notes = [];
    if (history_truncated) {
      notes.push(
        "Local history before timeline_min_tick was pruned; full room replay may be impossible without reloading posts."
      );
    }
    if (initial_tick === null || target_tick < initial_tick) {
      notes.push("No replayable post range available at target tick.");
      return {
        target_tick,
        initial_tick,
        cache_invalidated: true,
        invalidated_snapshot_count,
        history_truncated,
        state: this.init,
        notes
      };
    }
    const state = this.compute_state_at_uncached(initial_tick, target_tick);
    return {
      target_tick,
      initial_tick,
      cache_invalidated: true,
      invalidated_snapshot_count,
      history_truncated,
      state,
      notes
    };
  }
  // Post data to the room.
  post(data) {
    const name = this.client_api.post(this.room, data, this.packer);
    const t = this.server_time();
    const local_post = {
      room: this.room,
      index: -1,
      server_time: t,
      client_time: t,
      name,
      data
    };
    this.add_local_post(name, local_post);
  }
  // Convenience for compute_state_at(current_server_tick).
  compute_current_state() {
    return this.compute_state_at(this.server_tick());
  }
  on_sync(callback) {
    this.client_api.on_sync(callback);
  }
  ping() {
    return this.client_api.ping();
  }
  close() {
    if (this.latest_index_poll_interval_id !== null) {
      clearInterval(this.latest_index_poll_interval_id);
      this.latest_index_poll_interval_id = null;
    }
    this.client_api.close();
  }
  static gen_name() {
    return gen_name();
  }
};
__publicField(_VibiNet, "game", _VibiNet);
var VibiNet = _VibiNet;

// src/game.ts
var MAX_CHAT_MESSAGES = 120;
var BOT_ID = "bot-cipher";
var BOT_NAME = "Cipher Bot";
var matchPostPacker = {
  $: "Union",
  variants: {
    join: {
      $: "Struct",
      fields: {
        id: { $: "String" },
        name: { $: "String" },
        isBot: { $: "UInt", size: 1 }
      }
    },
    leave: {
      $: "Struct",
      fields: {
        id: { $: "String" }
      }
    },
    chat: {
      $: "Struct",
      fields: {
        id: { $: "String" },
        name: { $: "String" },
        text: { $: "String" }
      }
    },
    ready: {
      $: "Struct",
      fields: {
        id: { $: "String" },
        name: { $: "String" },
        isBot: { $: "UInt", size: 1 },
        seat: { $: "UInt", size: 1 }
      }
    },
    choose: {
      $: "Struct",
      fields: {
        id: { $: "String" },
        cardId: { $: "String" }
      }
    },
    advance: {
      $: "Struct",
      fields: {
        id: { $: "String" }
      }
    }
  }
};
var roleNames = {
  commander_spy: "Comandante Espiao",
  government_informant: "Informante do Governo"
};
var initialState = (roomId) => ({
  roomId,
  participants: {},
  participantOrder: [],
  chat: [],
  chatCounter: 0,
  systemCounter: 0,
  match: createWaitingMatch(1)
});
function createWaitingMatch(matchId) {
  return {
    matchId,
    status: "waiting",
    p1Id: null,
    p2Id: null,
    roundIndex: 0,
    turn: null,
    hands: {
      p1: [],
      p2: []
    },
    selectedCardIds: {
      p1: null,
      p2: null
    },
    reveal: null,
    roundSummaries: [],
    totals: {
      p1: 0,
      p2: 0
    },
    winner: null
  };
}
function roleForRound(roundIndex, slot) {
  const p1Role = roundIndex % 2 === 0 ? "government_informant" : "commander_spy";
  if (slot === "p1") {
    return p1Role;
  }
  return p1Role === "government_informant" ? "commander_spy" : "government_informant";
}
function deckForRole(role) {
  if (role === "commander_spy") {
    return [
      { id: "spy-1", kind: "spy", used: false },
      { id: "agent-1", kind: "agent", used: false },
      { id: "agent-2", kind: "agent", used: false },
      { id: "agent-3", kind: "agent", used: false },
      { id: "agent-4", kind: "agent", used: false }
    ];
  }
  return [
    { id: "true-file-1", kind: "true_file", used: false },
    { id: "false-file-1", kind: "false_file", used: false },
    { id: "false-file-2", kind: "false_file", used: false },
    { id: "false-file-3", kind: "false_file", used: false },
    { id: "false-file-4", kind: "false_file", used: false }
  ];
}
function cloneCard(card) {
  return {
    id: card.id,
    kind: card.kind,
    used: card.used
  };
}
function cloneMatch(match) {
  return {
    matchId: match.matchId,
    status: match.status,
    p1Id: match.p1Id,
    p2Id: match.p2Id,
    roundIndex: match.roundIndex,
    turn: match.turn,
    hands: {
      p1: match.hands.p1.map(cloneCard),
      p2: match.hands.p2.map(cloneCard)
    },
    selectedCardIds: {
      p1: match.selectedCardIds.p1,
      p2: match.selectedCardIds.p2
    },
    reveal: match.reveal ? {
      p1Card: match.reveal.p1Card,
      p2Card: match.reveal.p2Card,
      points: { ...match.reveal.points },
      roundEnded: match.reveal.roundEnded,
      summary: match.reveal.summary,
      comboLabel: match.reveal.comboLabel
    } : null,
    roundSummaries: match.roundSummaries.map((summary) => ({ ...summary })),
    totals: { ...match.totals },
    winner: match.winner
  };
}
function cloneState(state) {
  return {
    roomId: state.roomId,
    participants: Object.fromEntries(
      Object.entries(state.participants).map(([id, participant]) => [id, { ...participant }])
    ),
    participantOrder: [...state.participantOrder],
    chat: state.chat.map((message) => ({ ...message })),
    chatCounter: state.chatCounter,
    systemCounter: state.systemCounter,
    match: cloneMatch(state.match)
  };
}
function ensureParticipant(state, participant) {
  const cleanName = participant.name.trim().slice(0, 24) || "Operador";
  const existing = state.participants[participant.id];
  if (existing) {
    existing.name = cleanName;
    existing.isBot = participant.isBot;
    return;
  }
  const joinedAt = state.participantOrder.length + 1;
  state.participants[participant.id] = {
    id: participant.id,
    name: cleanName,
    joinedAt,
    isBot: participant.isBot
  };
  state.participantOrder.push(participant.id);
}
function systemMessage(state, text) {
  state.systemCounter += 1;
  state.chatCounter += 1;
  const nextMessage = {
    id: state.chatCounter,
    authorId: "system",
    authorName: "Central",
    text,
    kind: "system"
  };
  state.chat = [...state.chat, nextMessage].slice(-MAX_CHAT_MESSAGES);
}
function userMessage(state, post) {
  const clean = post.text.trim().replace(/\s+/g, " ").slice(0, 220);
  if (!clean) {
    return;
  }
  state.chatCounter += 1;
  const nextMessage = {
    id: state.chatCounter,
    authorId: post.id,
    authorName: post.name.trim().slice(0, 24) || "Operador",
    text: clean,
    kind: "user"
  };
  state.chat = [...state.chat, nextMessage].slice(-MAX_CHAT_MESSAGES);
}
function playerSeat(match, id) {
  if (match.p1Id === id) {
    return "p1";
  }
  if (match.p2Id === id) {
    return "p2";
  }
  return "spectator";
}
function oppositeSlot(slot) {
  return slot === "p1" ? "p2" : "p1";
}
function firstTurnSlot(roundIndex) {
  return roleForRound(roundIndex, "p1") === "government_informant" ? "p1" : "p2";
}
function startRound(match) {
  match.status = "playing";
  match.turn = firstTurnSlot(match.roundIndex);
  match.hands = {
    p1: deckForRole(roleForRound(match.roundIndex, "p1")),
    p2: deckForRole(roleForRound(match.roundIndex, "p2"))
  };
  match.selectedCardIds = {
    p1: null,
    p2: null
  };
  match.reveal = null;
}
function startMatchFromSeats(match) {
  if (!match.p1Id || !match.p2Id) {
    return;
  }
  match.roundIndex = 0;
  match.roundSummaries = [];
  match.totals = { p1: 0, p2: 0 };
  match.winner = null;
  startRound(match);
}
function availableCard(match, slot, cardId) {
  const found = match.hands[slot].find((card) => card.id === cardId);
  if (!found || found.used) {
    return null;
  }
  return found;
}
function labelCard(card) {
  switch (card) {
    case "spy":
      return "Spy";
    case "agent":
      return "Agent";
    case "true_file":
      return "True File";
    case "false_file":
      return "False File";
  }
}
function determineWinner(points) {
  if (points.p1 === points.p2) {
    return "tie";
  }
  return points.p1 > points.p2 ? "p1" : "p2";
}
function resolveCards(p1Card, p2Card, p1Role, p2Role) {
  const commanderSlot = p1Role === "commander_spy" ? "p1" : "p2";
  const informantSlot = commanderSlot === "p1" ? "p2" : "p1";
  const commanderCard = commanderSlot === "p1" ? p1Card : p2Card;
  const informantCard = informantSlot === "p1" ? p1Card : p2Card;
  const points = { p1: 0, p2: 0 };
  let roundEnded = false;
  let summary = "Nenhum ponto. As cartas restantes seguem para o proximo turno.";
  if (commanderCard === "agent" && informantCard === "false_file") {
    roundEnded = false;
    summary = "Agent encontrou False File. Rodada continua sem pontuacao.";
  } else if (commanderCard === "agent" && informantCard === "true_file") {
    roundEnded = true;
    points[informantSlot] += 1;
    summary = `${roleNames[p1Role]} x ${roleNames[p2Role]}: o informante acha o arquivo verdadeiro e marca 1 ponto.`;
  } else if (commanderCard === "spy" && informantCard === "false_file") {
    roundEnded = true;
    points[informantSlot] += 1;
    summary = `${roleNames[p1Role]} x ${roleNames[p2Role]}: o spy caiu num falso arquivo e o governo marca 1 ponto.`;
  } else if (commanderCard === "spy" && informantCard === "true_file") {
    roundEnded = true;
    points[commanderSlot] += 5;
    summary = `${roleNames[p1Role]} x ${roleNames[p2Role]}: o comandante espiao capturou o true file e marca 5 pontos.`;
  }
  return {
    p1Card,
    p2Card,
    points,
    roundEnded,
    summary,
    comboLabel: `${labelCard(p1Card)} x ${labelCard(p2Card)}`
  };
}
function roundSummary(match, reveal) {
  return {
    round: match.roundIndex + 1,
    p1Role: roleForRound(match.roundIndex, "p1"),
    p2Role: roleForRound(match.roundIndex, "p2"),
    winner: determineWinner(reveal.points),
    reason: reveal.summary,
    p1Points: reveal.points.p1,
    p2Points: reveal.points.p2
  };
}
function handleLeave(state, id) {
  if (!state.participants[id]) {
    return;
  }
  const participant = state.participants[id];
  delete state.participants[id];
  state.participantOrder = state.participantOrder.filter((participantId) => participantId !== id);
  const seat = playerSeat(state.match, id);
  if (seat === "p1" || seat === "p2") {
    const nextMatchId = state.match.matchId + 1;
    state.match = createWaitingMatch(nextMatchId);
    systemMessage(state, `${participant.name} saiu da partida. A sala voltou ao lobby.`);
    return;
  }
  systemMessage(state, `${participant.name} saiu da sala.`);
}
function assignReadySeat(state, participant, desiredSlot) {
  const match = state.match;
  if (match.status === "ended") {
    state.match = createWaitingMatch(match.matchId + 1);
  }
  const current = state.match;
  if (current.status !== "waiting") {
    return;
  }
  const currentSeat = playerSeat(current, participant.id);
  const targetRoleName = roleNames[roleForRound(0, desiredSlot)].toLowerCase();
  const occupantId = desiredSlot === "p1" ? current.p1Id : current.p2Id;
  if (occupantId && occupantId !== participant.id) {
    return;
  }
  if (currentSeat === desiredSlot) {
    return;
  }
  if (currentSeat === "p1") {
    current.p1Id = null;
  } else if (currentSeat === "p2") {
    current.p2Id = null;
  }
  if (desiredSlot === "p1") {
    current.p1Id = participant.id;
  } else {
    current.p2Id = participant.id;
  }
  systemMessage(state, `${participant.name} escolheu comecar como ${targetRoleName}.`);
  if (current.p1Id && current.p2Id) {
    startMatchFromSeats(current);
  }
}
function applyRoomPost(previous, post) {
  const state = cloneState(previous);
  switch (post.$) {
    case "join": {
      const alreadyPresent = Boolean(state.participants[post.id]);
      ensureParticipant(state, {
        id: post.id,
        name: post.name,
        isBot: post.isBot === 1
      });
      if (!alreadyPresent) {
        const participant = state.participants[post.id];
        systemMessage(state, `${participant.name} entrou na sala.`);
      }
      return state;
    }
    case "leave": {
      handleLeave(state, post.id);
      return state;
    }
    case "chat": {
      if (!state.participants[post.id]) {
        ensureParticipant(state, {
          id: post.id,
          name: post.name,
          isBot: false
        });
      }
      userMessage(state, post);
      return state;
    }
    case "ready": {
      ensureParticipant(state, {
        id: post.id,
        name: post.name,
        isBot: post.isBot === 1
      });
      assignReadySeat(state, state.participants[post.id], post.seat === 0 ? "p1" : "p2");
      return state;
    }
    case "choose": {
      const match = state.match;
      if (match.status !== "playing" || !match.turn) {
        return state;
      }
      const seat = playerSeat(match, post.id);
      if (seat !== match.turn) {
        return state;
      }
      const card = availableCard(match, seat, post.cardId);
      if (!card) {
        return state;
      }
      card.used = true;
      match.selectedCardIds[seat] = card.id;
      if (seat === firstTurnSlot(match.roundIndex)) {
        match.turn = oppositeSlot(seat);
        return state;
      }
      const p1CardId = match.selectedCardIds.p1;
      const p2CardId = match.selectedCardIds.p2;
      if (!p1CardId || !p2CardId) {
        return state;
      }
      const p1Card = match.hands.p1.find((entry) => entry.id === p1CardId);
      const p2Card = match.hands.p2.find((entry) => entry.id === p2CardId);
      if (!p1Card || !p2Card) {
        return state;
      }
      match.status = "revealed";
      match.turn = null;
      match.reveal = resolveCards(
        p1Card.kind,
        p2Card.kind,
        roleForRound(match.roundIndex, "p1"),
        roleForRound(match.roundIndex, "p2")
      );
      if (match.reveal.roundEnded) {
        match.totals.p1 += match.reveal.points.p1;
        match.totals.p2 += match.reveal.points.p2;
        match.roundSummaries = [...match.roundSummaries, roundSummary(match, match.reveal)];
      }
      return state;
    }
    case "advance": {
      const match = state.match;
      const seat = playerSeat(match, post.id);
      if (seat === "spectator" || match.status !== "revealed" || !match.reveal) {
        return state;
      }
      if (!match.reveal.roundEnded) {
        match.status = "playing";
        match.turn = firstTurnSlot(match.roundIndex);
        match.selectedCardIds = { p1: null, p2: null };
        match.reveal = null;
        return state;
      }
      if (match.roundIndex === 3) {
        match.status = "ended";
        match.turn = null;
        match.selectedCardIds = { p1: null, p2: null };
        match.winner = determineWinner(match.totals);
        return state;
      }
      match.roundIndex += 1;
      startRound(match);
      return state;
    }
  }
}
function createInitialRoomState(roomId) {
  return initialState(roomId);
}
function createPacker() {
  return matchPostPacker;
}
function getRoleName(role) {
  return roleNames[role];
}
function getRoleForSlot(roundIndex, slot) {
  return roleForRound(roundIndex, slot);
}
function getSeat(state, id) {
  return playerSeat(state.match, id);
}
function getParticipantList(state) {
  return state.participantOrder.map((id) => state.participants[id]).filter((participant) => Boolean(participant));
}
function getBotIdentity() {
  return {
    id: BOT_ID,
    name: BOT_NAME
  };
}
function getCardLabel(card) {
  return labelCard(card);
}

// src/app.ts
var STORAGE_NAME_KEY = "the-spy-name";
var STORAGE_ID_KEY = "the-spy-viewer-id";
var ROOM_SCHEMA_VERSION = "v4";
var ROOM_NAMESPACE = "the-spy-" + ROOM_SCHEMA_VERSION;
function buildNetworkRoomId(roomId) {
  return ROOM_NAMESPACE + "__" + roomId;
}
function oppositeSlot2(slot) {
  return slot === "p1" ? "p2" : "p1";
}
function currentRoleForSeat(match, seat) {
  return getRoleForSlot(match.roundIndex, seat);
}
function seatRoleName(match, seat, useStartingRole = false) {
  return getRoleName(useStartingRole ? getRoleForSlot(0, seat) : currentRoleForSeat(match, seat));
}
var SoloController = class {
  constructor(viewerId, viewerName, roomId) {
    this.mode = "solo";
    this.listeners = /* @__PURE__ */ new Set();
    this.botId = getBotIdentity().id;
    this.botName = getBotIdentity().name;
    this.botTimer = null;
    this.continueTimer = null;
    this.viewerId = viewerId;
    this.viewerName = viewerName;
    this.roomId = roomId;
    this.state = createInitialRoomState(roomId);
    this.post({
      $: "join",
      id: viewerId,
      name: viewerName,
      isBot: 0
    });
    this.post({
      $: "join",
      id: this.botId,
      name: this.botName,
      isBot: 1
    });
  }
  subscribe(listener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  getState() {
    return this.state;
  }
  post(post) {
    this.state = applyRoomPost(this.state, post);
    this.emit();
    this.maybeScheduleBot();
  }
  destroy() {
    if (this.botTimer !== null) {
      window.clearTimeout(this.botTimer);
    }
    if (this.continueTimer !== null) {
      window.clearTimeout(this.continueTimer);
    }
  }
  emit() {
    this.listeners.forEach((listener) => listener());
  }
  maybeScheduleBot() {
    if (this.botTimer !== null) {
      window.clearTimeout(this.botTimer);
      this.botTimer = null;
    }
    if (this.continueTimer !== null) {
      window.clearTimeout(this.continueTimer);
      this.continueTimer = null;
    }
    const match = this.state.match;
    const botSeat = match.p1Id === this.botId ? "p1" : match.p2Id === this.botId ? "p2" : null;
    const viewerSeat = match.p1Id === this.viewerId ? "p1" : match.p2Id === this.viewerId ? "p2" : null;
    if (match.status === "waiting" && viewerSeat && !botSeat) {
      const emptySeat = oppositeSlot2(viewerSeat);
      this.botTimer = window.setTimeout(() => {
        this.post({
          $: "ready",
          id: this.botId,
          name: this.botName,
          isBot: 1,
          seat: emptySeat === "p1" ? 0 : 1
        });
      }, 650);
      return;
    }
    if (match.status === "playing" && match.turn && botSeat && match.turn === botSeat) {
      const card = nextBotCard(match, botSeat);
      if (!card) {
        return;
      }
      this.botTimer = window.setTimeout(() => {
        this.post({
          $: "choose",
          id: this.botId,
          cardId: card.id
        });
      }, 750);
      return;
    }
    if (match.status === "revealed" && botSeat) {
      this.continueTimer = window.setTimeout(() => {
        this.post({
          $: "advance",
          id: this.botId
        });
      }, 1300);
    }
  }
};
var MultiplayerController = class {
  constructor(viewerId, viewerName, roomId) {
    this.mode = "multiplayer";
    this.listeners = /* @__PURE__ */ new Set();
    this.isSynced = false;
    this.pendingPosts = [];
    this.lastRenderKey = "";
    this.viewerId = viewerId;
    this.viewerName = viewerName;
    this.roomId = roomId;
    const networkRoomId = buildNetworkRoomId(roomId);
    this.initialState = createInitialRoomState(roomId);
    this.game = new VibiNet.game({
      room: networkRoomId,
      initial: this.initialState,
      on_tick: (state) => state,
      on_post: (post, currentState) => applyRoomPost(currentState, post),
      packer: createPacker(),
      tick_rate: 8,
      tolerance: 350
    });
    this.unloadHandler = () => {
      if (!this.isSynced) {
        return;
      }
      this.safePostToGame({
        $: "leave",
        id: viewerId
      });
    };
    this.installGameHooks();
    window.addEventListener("beforeunload", this.unloadHandler);
    this.game.on_sync(() => {
      this.isSynced = true;
      this.flushPendingPosts();
      this.emitIfChanged(true);
    });
    this.post({
      $: "join",
      id: viewerId,
      name: viewerName,
      isBot: 0
    });
  }
  subscribe(listener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  getState() {
    return this.isSynced ? this.game.compute_render_state() : this.initialState;
  }
  post(post) {
    if (!this.isSynced) {
      this.pendingPosts.push(post);
      return;
    }
    this.safePostToGame(post);
  }
  destroy() {
    if (this.isSynced) {
      this.safePostToGame({
        $: "leave",
        id: this.viewerId
      });
    }
    this.pendingPosts = [];
    window.removeEventListener("beforeunload", this.unloadHandler);
    this.game.close();
  }
  emit() {
    this.listeners.forEach((listener) => listener());
  }
  installGameHooks() {
    const internalGame = this.game;
    const addRemotePost = internalGame.add_remote_post;
    if (typeof addRemotePost === "function") {
      internalGame.add_remote_post = (post) => {
        addRemotePost.call(this.game, post);
        this.emitIfChanged();
      };
    }
    const addLocalPost = internalGame.add_local_post;
    if (typeof addLocalPost === "function") {
      internalGame.add_local_post = (name, post) => {
        addLocalPost.call(this.game, name, post);
        this.emitIfChanged();
      };
    }
    const removeLocalPost = internalGame.remove_local_post;
    if (typeof removeLocalPost === "function") {
      internalGame.remove_local_post = (name) => {
        removeLocalPost.call(this.game, name);
        this.emitIfChanged();
      };
    }
  }
  emitIfChanged(force = false) {
    const nextKey = JSON.stringify(this.game.compute_render_state());
    if (force || nextKey !== this.lastRenderKey) {
      this.lastRenderKey = nextKey;
      this.emit();
    }
  }
  flushPendingPosts() {
    if (!this.isSynced || this.pendingPosts.length === 0) {
      return;
    }
    const queued = this.pendingPosts;
    this.pendingPosts = [];
    for (const post of queued) {
      this.safePostToGame(post);
    }
  }
  safePostToGame(post) {
    try {
      this.game.post(post);
    } catch (error) {
      console.error("[The Spy] failed to post room event", post.$, error);
    }
  }
};
function mountApp(root2) {
  const state = {
    screen: "home",
    currentName: loadName(),
    currentRoom: "",
    controller: null,
    dismissedMatchId: null
  };
  const viewerId = loadViewerId();
  const rerender = () => {
    root2.innerHTML = render(state, viewerId);
    bindEvents(state, viewerId, rerender);
  };
  rerender();
}
function render(state, viewerId) {
  if (state.screen === "home" || !state.controller) {
    return renderHome(state);
  }
  const roomState = state.controller.getState();
  const match = roomState.match;
  const shouldOpenModal = match.status === "ended" && state.dismissedMatchId !== match.matchId && match.roundSummaries.length > 0;
  return `
    <div class="screen room-screen">
      <section class="main-column">
        <header class="room-header">
          <div class="room-title-wrap">
            <span class="eyebrow">Sala ativa</span>
            <h1 class="room-title">The Spy</h1>
          </div>
          <div class="button-row">
            <button class="ghost-button" data-action="leave-room">Sair da sala</button>
          </div>
        </header>

        <div class="main-surface">
          ${renderGamePanel(roomState, viewerId, state.controller.mode)}
          <aside class="sidebar">
            ${renderPlayersPanel(roomState, viewerId)}
            ${renderChatPanel(roomState)}
            ${renderRoomInfoPanel(state.controller)}
          </aside>
        </div>
      </section>
      ${shouldOpenModal ? renderResultModal(roomState, viewerId) : ""}
    </div>
  `;
}
function renderHome(state) {
  const multiplayerEnabled = Boolean(state.currentName.trim() && state.currentRoom.trim());
  return `
    <div class="screen home-screen">
      <section class="home-card">
        <div class="home-hero">
          <span class="eyebrow">Projeto multiplayer de cartas</span>
          <h1>The Spy</h1>
          <p>
            Entre numa sala para jogar online com espectadores e chat, ou valide
            as quatro rodadas primeiro no modo local contra o bot.
          </p>
        </div>

        <div class="home-actions">
          <article class="action-card">
            <h2>Vs Bot</h2>
            <p>
              Partida local com o mesmo tabuleiro, regras e alternancia de papeis.
            </p>
            <div class="button-row">
              <button class="secondary-button" data-action="start-solo">Iniciar vs bot</button>
            </div>
          </article>

          <article class="action-card">
            <h2>Multiplayer</h2>
            <p>
              <code>usuario</code> e <code>sala</code> sao obrigatorios para entrar e sincronizar a partida.
            </p>
            <div class="field-grid">
              <label class="field-label">
                Nome
                <input
                  class="text-input"
                  id="name-input"
                  maxlength="24"
                  value="${escapeAttribute(state.currentName)}"
                  placeholder="Seu nick"
                />
              </label>
              <label class="field-label">
                Room
                <input
                  class="text-input"
                  id="room-input"
                  maxlength="32"
                  value="${escapeAttribute(state.currentRoom)}"
                  placeholder="codigo-da-sala"
                />
              </label>
            </div>
            <div class="button-row">
              <button class="primary-button" data-action="start-multiplayer" ${multiplayerEnabled ? "" : "disabled"}>
                Multiplayer
              </button>
            </div>
          </article>
        </div>
      </section>
    </div>
  `;
}
function renderPlayersPanel(state, viewerId) {
  const rows = getParticipantList(state).map((participant) => {
    const seat = getSeat(state, participant.id);
    const seatLabel = seat === "spectator" ? "Espectador" : seatRoleName(state.match, seat, state.match.status === "waiting" || state.match.status === "ended");
    const youLabel = participant.id === viewerId ? " \xB7 voce" : "";
    return `
        <div class="player-row">
          <strong>${escapeHtml(participant.name)}${youLabel}</strong>
          <div class="button-row">
            <span class="seat-pill ${seat === "spectator" ? "spectator" : ""}">${escapeHtml(seatLabel)}</span>
            ${participant.isBot ? '<span class="tag bot">bot</span>' : '<span class="tag">humano</span>'}
          </div>
        </div>
      `;
  }).join("");
  return `
    <section class="sidebar-panel">
      <div>
        <h2 class="panel-title">Conectados</h2>
        <p class="panel-copy">Lista de pessoas na mesma sala, incluindo espectadores.</p>
      </div>
      <div class="players-list">
        ${rows || '<p class="empty-state">Ainda nao ha jogadores conectados.</p>'}
      </div>
    </section>
  `;
}
function renderChatPanel(state) {
  const messages = state.chat.map((message) => {
    return `
        <article class="chat-message ${message.kind === "system" ? "system" : ""}">
          <strong>${escapeHtml(message.authorName)}</strong>
          <p>${escapeHtml(message.text)}</p>
        </article>
      `;
  }).join("");
  return `
    <section class="sidebar-panel chat-panel">
      <div>
        <h2 class="panel-title">Chat</h2>
        <div class="chat-meta">
          <span>Mensagens recentes da sala</span>
          <span>${state.chat.length} itens</span>
        </div>
      </div>
      <div class="chat-list">
        ${messages || '<p class="empty-state">O chat ainda esta vazio.</p>'}
      </div>
      <form class="chat-form" data-action="send-chat">
        <input
          class="chat-input"
          id="chat-input"
          maxlength="220"
          placeholder="Escreva uma mensagem para a sala"
        />
        <button class="primary-button" type="submit">Enviar</button>
      </form>
    </section>
  `;
}
function renderRoomInfoPanel(controller) {
  return `
    <section class="sidebar-panel info-panel">
      <div>
        <h2 class="panel-title">Sessao</h2>
        <p class="panel-copy">Dados da conexao e identificacao da sala atual.</p>
      </div>
      <div class="info-list">
        <div class="info-item">
          <span class="tiny">Sala</span>
          <strong>${escapeHtml(controller.roomId)}</strong>
        </div>
        <div class="info-item">
          <span class="tiny">Usuario</span>
          <strong>${escapeHtml(controller.viewerName)}</strong>
        </div>
        <div class="info-item">
          <span class="tiny">Modo</span>
          <strong>${controller.mode === "solo" ? "Vs Bot" : "Online"}</strong>
        </div>
      </div>
    </section>
  `;
}
function renderGamePanel(state, viewerId, mode) {
  const match = state.match;
  const viewerSeat = getSeat(state, viewerId);
  const roundLabel = `Rodada ${Math.min(match.roundIndex + 1, 4)} / 4`;
  const p1Role = getRoleForSlot(match.roundIndex, "p1");
  const p2Role = getRoleForSlot(match.roundIndex, "p2");
  const showWaitingState = match.status === "waiting" || match.status === "ended";
  return `
    <section class="game-panel">
      <div class="game-top">
        <div class="status-block">
          <span class="eyebrow">${roundLabel}</span>
          <h2>Lobby e Partida</h2>
          <p class="status-text">${escapeHtml(statusHeadline(match, viewerSeat))}</p>
        </div>
        <div class="button-row">
          <span class="score-pill">P1 ${match.totals.p1} pts</span>
          <span class="score-pill">P2 ${match.totals.p2} pts</span>
        </div>
      </div>

      <div class="roles-grid">
        ${renderRoleCard("P1", match.p1Id, state, p1Role)}
        ${renderRoleCard("P2", match.p2Id, state, p2Role)}
      </div>

      ${showWaitingState ? renderWaitingPanel(state, viewerId, mode) : renderBoard(state, viewerId)}

      <div class="board-footer">
        <span class="tiny">
          ${mode === "solo" ? "Modo local: o bot ocupa o cargo restante automaticamente." : "Modo online: uma sala comporta uma partida ativa por vez via vibinet."}
        </span>
        ${renderActionFooter(state, viewerId)}
      </div>
    </section>
  `;
}
function renderRoleCard(label, participantId, state, role) {
  const participant = participantId ? state.participants[participantId] : null;
  return `
    <article class="role-card">
      <span class="role-pill ${role === "commander_spy" ? "spy" : ""}">${escapeHtml(label)}</span>
      <h3>${participant ? escapeHtml(participant.name) : "Aguardando jogador"}</h3>
      <p>${escapeHtml(getRoleName(role))}</p>
    </article>
  `;
}
function renderWaitingPanel(state, viewerId, mode) {
  const match = state.match;
  const viewerSeat = getSeat(state, viewerId);
  const ended = match.status === "ended";
  const informantSeat = getRoleForSlot(0, "p1") === "government_informant" ? "p1" : "p2";
  const commanderSeat = oppositeSlot2(informantSeat);
  const informantOccupantId = ended ? null : informantSeat === "p1" ? match.p1Id : match.p2Id;
  const commanderOccupantId = ended ? null : commanderSeat === "p1" ? match.p1Id : match.p2Id;
  const canChooseInformant = !informantOccupantId || informantOccupantId === viewerId;
  const canChooseCommander = !commanderOccupantId || commanderOccupantId === viewerId;
  const informantText = informantOccupantId ? escapeHtml(state.participants[informantOccupantId]?.name ?? "Reservado") : "Disponivel";
  const commanderText = commanderOccupantId ? escapeHtml(state.participants[commanderOccupantId]?.name ?? "Reservado") : "Disponivel";
  return `
    <div class="waiting-panel">
      <div class="status-banner">
        <strong>${escapeHtml(waitingHeadline(match, viewerSeat, mode))}</strong>
        <p class="status-text">
          Escolha o cargo inicial. O informante do governo sempre abre cada turno.
        </p>
      </div>

      <div class="waiting-seat-grid">
        <article class="seat-card">
          <h3>Comeca como Informante do Governo</h3>
          <p>${informantText}</p>
        </article>
        <article class="seat-card">
          <h3>Comeca como Comandante Espiao</h3>
          <p>${commanderText}</p>
        </article>
      </div>

      <div class="button-row waiting-button-row">
        <button
          class="primary-button"
          data-action="ready-role"
          data-seat="${informantSeat}"
          ${canChooseInformant ? "" : "disabled"}
        >
          Comecar como informante do governo
        </button>
        <button
          class="secondary-button"
          data-action="ready-role"
          data-seat="${commanderSeat}"
          ${canChooseCommander ? "" : "disabled"}
        >
          Comecar como comandante espiao
        </button>
      </div>
    </div>
  `;
}
function renderBoard(state, viewerId) {
  const match = state.match;
  const viewerSeat = getSeat(state, viewerId);
  const perspective = boardPerspective(viewerSeat);
  const bottomCards = match.hands[perspective.bottom];
  const topCards = match.hands[perspective.top];
  const activeTurn = match.turn;
  const canSeeBottom = viewerSeat === perspective.bottom;
  const bottomSelectable = canSeeBottom && activeTurn === perspective.bottom;
  const slots = /* @__PURE__ */ new Map();
  topCards.forEach((card, index) => {
    slots.set(`r1c${index + 1}`, renderTopCard(card));
  });
  bottomCards.forEach((card, index) => {
    slots.set(`r4c${index + 1}`, renderBottomCard(card, canSeeBottom, bottomSelectable));
  });
  slots.set("r2c3", renderPlayedCard(match, perspective.top, viewerSeat, perspective.top));
  slots.set("r3c3", renderPlayedCard(match, perspective.bottom, viewerSeat, perspective.bottom));
  const grid = [];
  for (let row = 1; row <= 4; row += 1) {
    for (let column = 1; column <= 5; column += 1) {
      const key = `r${row}c${column}`;
      const extraClass = key === "r2c3" || key === "r3c3" ? "play-slot" : "";
      grid.push(`<div class="card-slot ${extraClass}">${slots.get(key) ?? ""}</div>`);
    }
  }
  return `
    <div class="game-board">
      <div class="board-grid">
        ${grid.join("")}
      </div>
      <div class="status-banner">
        <strong>${escapeHtml(boardNarration(match, viewerSeat))}</strong>
        <p class="status-text">${escapeHtml(match.reveal?.summary ?? "Cada jogada vai para o centro virada para baixo ate a revelacao.")}</p>
      </div>
    </div>
  `;
}
function renderTopCard(card) {
  if (card.used) {
    return "";
  }
  return '<div class="card face-down"><span>Oculta</span></div>';
}
function renderBottomCard(card, canSeeLabel, selectable) {
  if (card.used) {
    return "";
  }
  if (!canSeeLabel) {
    return '<div class="card face-down"><span>Oculta</span></div>';
  }
  const label = getCardLabel(card.kind);
  return `
    <button
      class="card face-up ${cardClass(card.kind)} ${selectable ? "selectable" : "disabled"}"
      ${selectable ? `data-action="choose-card" data-card-id="${escapeAttribute(card.id)}"` : "disabled"}
    >
      <span>${escapeHtml(label)}</span>
    </button>
  `;
}
function renderPlayedCard(match, slot, viewerSeat, perspectiveSlot) {
  const cardId = match.selectedCardIds[slot];
  if (!cardId) {
    return "";
  }
  if (match.status === "revealed" && match.reveal) {
    const kind = slot === "p1" ? match.reveal.p1Card : match.reveal.p2Card;
    return `
      <div class="card face-up ${cardClass(kind)}">
        <span>${escapeHtml(getCardLabel(kind))}</span>
      </div>
    `;
  }
  return '<div class="card face-down"><span>Travada</span></div>';
}
function renderActionFooter(state, viewerId) {
  const match = state.match;
  const seat = getSeat(state, viewerId);
  if (match.status !== "revealed" || seat === "spectator") {
    return "";
  }
  return `
    <button class="ghost-button" data-action="advance-turn">
      ${match.reveal?.roundEnded ? "Proxima etapa" : "Proximo turno"}
    </button>
  `;
}
function renderResultModal(state, viewerId) {
  const match = state.match;
  const rows = match.roundSummaries.map((summary) => renderSummaryRow(summary)).join("");
  const winner = matchWinnerLabel(match, state);
  const viewerSeat = getSeat(state, viewerId);
  return `
    <div class="modal">
      <div class="modal-card">
        <div>
          <span class="eyebrow">Fim da partida</span>
          <h2>${escapeHtml(winner)}</h2>
          <p class="panel-copy">${escapeHtml(resultSubtitle(match, viewerSeat, state))}</p>
        </div>

        <div class="modal-table">
          <div class="table-row head">
            <div>Rodada</div>
            <div>Resultado</div>
            <div>P1</div>
            <div>P2</div>
          </div>
          ${rows}
        </div>

        <div class="status-banner">
          <strong>Placares finais</strong>
          <p class="status-text">P1 fez ${match.totals.p1} ponto(s) e P2 fez ${match.totals.p2} ponto(s).</p>
        </div>

        <div class="modal-footer">
          <span class="tiny">Voltar fecha o popup e devolve a sala ao estado de lobby com os botoes de cargo.</span>
          <button class="primary-button" data-action="dismiss-result">Voltar para o lobby</button>
        </div>
      </div>
    </div>
  `;
}
function renderSummaryRow(summary) {
  return `
    <div class="table-row">
      <div>#${summary.round}</div>
      <div>${escapeHtml(summary.reason)}</div>
      <div>${summary.p1Points}</div>
      <div>${summary.p2Points}</div>
    </div>
  `;
}
function bindEvents(state, viewerId, rerender) {
  const nameInput = document.getElementById("name-input");
  const roomInput = document.getElementById("room-input");
  const multiplayerButton = document.querySelector('[data-action="start-multiplayer"]');
  const syncMultiplayerButton = () => {
    if (!multiplayerButton) {
      return;
    }
    multiplayerButton.disabled = !(state.currentName.trim() && state.currentRoom.trim());
  };
  nameInput?.addEventListener("input", () => {
    state.currentName = nameInput.value;
    saveName(state.currentName);
    syncMultiplayerButton();
  });
  roomInput?.addEventListener("input", () => {
    state.currentRoom = sanitizeRoom(roomInput.value);
    roomInput.value = state.currentRoom;
    syncMultiplayerButton();
  });
  document.querySelector('[data-action="start-solo"]')?.addEventListener("click", () => {
    const name = prepareName(state.currentName);
    state.currentName = name;
    saveName(name);
    const roomId = `solo-${Date.now().toString(36)}`;
    state.controller?.destroy();
    const controller = new SoloController(viewerId, name, roomId);
    controller.subscribe(() => rerender());
    state.controller = controller;
    state.dismissedMatchId = null;
    state.screen = "room";
    rerender();
  });
  document.querySelector('[data-action="start-multiplayer"]')?.addEventListener("click", () => {
    const name = prepareName(state.currentName);
    const roomId = sanitizeRoom(state.currentRoom);
    if (!name || !roomId) {
      return;
    }
    state.currentName = name;
    state.currentRoom = roomId;
    saveName(name);
    state.controller?.destroy();
    const controller = new MultiplayerController(viewerId, name, roomId);
    controller.subscribe(() => rerender());
    state.controller = controller;
    state.dismissedMatchId = null;
    state.screen = "room";
    rerender();
  });
  document.querySelector('[data-action="leave-room"]')?.addEventListener("click", () => {
    state.controller?.destroy();
    state.controller = null;
    state.screen = "home";
    rerender();
  });
  document.querySelectorAll('[data-action="ready-role"]').forEach((element) => {
    element.addEventListener("click", () => {
      if (!state.controller) {
        return;
      }
      const seat = element.dataset.seat === "p2" ? 1 : 0;
      state.dismissedMatchId = null;
      state.controller.post({
        $: "ready",
        id: state.controller.viewerId,
        name: state.controller.viewerName,
        isBot: 0,
        seat
      });
    });
  });
  document.querySelectorAll('[data-action="choose-card"]').forEach((element) => {
    element.addEventListener("click", () => {
      if (!state.controller) {
        return;
      }
      const cardId = element.dataset.cardId;
      if (!cardId) {
        return;
      }
      state.controller.post({
        $: "choose",
        id: state.controller.viewerId,
        cardId
      });
    });
  });
  document.querySelector('[data-action="advance-turn"]')?.addEventListener("click", () => {
    if (!state.controller) {
      return;
    }
    state.controller.post({
      $: "advance",
      id: state.controller.viewerId
    });
  });
  document.querySelector('[data-action="dismiss-result"]')?.addEventListener("click", () => {
    if (!state.controller) {
      return;
    }
    state.dismissedMatchId = state.controller.getState().match.matchId;
    rerender();
  });
  const chatForm = document.querySelector('[data-action="send-chat"]');
  const chatInput = document.getElementById("chat-input");
  chatForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!state.controller || !chatInput) {
      return;
    }
    const text = chatInput.value.trim();
    if (!text) {
      return;
    }
    state.controller.post({
      $: "chat",
      id: state.controller.viewerId,
      name: state.controller.viewerName,
      text
    });
    chatInput.value = "";
  });
}
function nextBotCard(match, seat) {
  const available = match.hands[seat].filter((card) => !card.used);
  if (available.length === 0) {
    return null;
  }
  const opponentSeat = oppositeSlot2(seat);
  const opponentCardId = match.selectedCardIds[opponentSeat];
  if (!opponentCardId) {
    return available[0] ?? null;
  }
  const opponentCard = match.hands[opponentSeat].find((card) => card.id === opponentCardId);
  const seatRole = getRoleForSlot(match.roundIndex, seat);
  if (!opponentCard) {
    return available[0] ?? null;
  }
  if (seatRole === "government_informant") {
    if (opponentCard.kind === "spy") {
      return available.find((card) => card.kind === "false_file") ?? available[0] ?? null;
    }
    return available.find((card) => card.kind === "true_file") ?? available[0] ?? null;
  }
  if (opponentCard.kind === "true_file") {
    return available.find((card) => card.kind === "spy") ?? available[0] ?? null;
  }
  return available.find((card) => card.kind === "agent") ?? available[0] ?? null;
}
function boardPerspective(viewerSeat) {
  if (viewerSeat === "p2") {
    return {
      top: "p1",
      bottom: "p2"
    };
  }
  return {
    top: "p2",
    bottom: "p1"
  };
}
function statusHeadline(match, viewerSeat) {
  if (match.status === "waiting") {
    return "Sala aberta. Cada jogador escolhe o cargo inicial antes da partida comecar.";
  }
  if (match.status === "ended") {
    return "As quatro rodadas terminaram. Feche o popup e monte outra partida na mesma sala.";
  }
  if (match.status === "revealed") {
    return "As cartas do turno atual ja foram reveladas.";
  }
  if (match.turn === viewerSeat) {
    return "Sua vez de escolher uma carta e travar no centro.";
  }
  if (match.turn) {
    return `${seatRoleName(match, match.turn)} escolhe agora.`;
  }
  return "A rodada esta aguardando a resolucao atual.";
}
function waitingHeadline(match, viewerSeat, mode) {
  if (match.status === "ended") {
    return "Partida encerrada. Escolha de novo quem comeca como informante e quem comeca como comandante.";
  }
  if (mode === "solo") {
    return "No modo local, o bot assume automaticamente o cargo que sobrar.";
  }
  if (viewerSeat === "spectator") {
    return "Escolha um dos dois cargos para entrar na partida. Se ambos estiverem ocupados, voce assiste.";
  }
  return "Voce ja escolheu um cargo inicial. Quando os dois assentos estiverem ocupados, a partida comeca.";
}
function boardNarration(match, viewerSeat) {
  if (match.status === "revealed" && match.reveal) {
    return `${match.reveal.comboLabel} \xB7 ${match.reveal.roundEnded ? "rodada encerrada" : "nenhuma pontuacao"}`;
  }
  if (match.turn === viewerSeat) {
    return "Clique numa carta da sua mao para enviar ao centro.";
  }
  if (match.turn) {
    return `${seatRoleName(match, match.turn)} decide agora. As duas cartas so abrem depois da resposta.`;
  }
  return "A jogada atual esta sendo resolvida.";
}
function resultSubtitle(match, viewerSeat, state) {
  if (match.winner === "tie") {
    return "Empate tecnico depois das quatro rodadas.";
  }
  const slot = match.winner;
  if (!slot) {
    return "A partida foi encerrada.";
  }
  const participantId = slot === "p1" ? match.p1Id : match.p2Id;
  const participant = participantId ? state.participants[participantId] : null;
  const suffix = viewerSeat === slot ? "Voce venceu." : "Esse jogador venceu a partida.";
  return `${participant?.name ?? slot.toUpperCase()} venceu. ${suffix}`;
}
function matchWinnerLabel(match, state) {
  if (match.winner === "tie") {
    return "Empate geral";
  }
  if (match.winner === "p1" && match.p1Id) {
    return `${state.participants[match.p1Id]?.name ?? "P1"} venceu`;
  }
  if (match.winner === "p2" && match.p2Id) {
    return `${state.participants[match.p2Id]?.name ?? "P2"} venceu`;
  }
  return "Partida encerrada";
}
function cardClass(kind) {
  switch (kind) {
    case "spy":
      return "spy";
    case "agent":
      return "agent";
    case "true_file":
      return "true-file";
    case "false_file":
      return "false-file";
  }
}
function prepareName(value) {
  return value.trim().slice(0, 24) || "Operador";
}
function sanitizeRoom(value) {
  return value.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-_]/g, "").slice(0, 32);
}
function loadName() {
  return window.localStorage.getItem(STORAGE_NAME_KEY) ?? "";
}
function saveName(name) {
  window.localStorage.setItem(STORAGE_NAME_KEY, name);
}
function loadViewerId() {
  const existing = window.sessionStorage.getItem(STORAGE_ID_KEY);
  if (existing) {
    return existing;
  }
  window.localStorage.removeItem(STORAGE_ID_KEY);
  const next = typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `viewer-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  window.sessionStorage.setItem(STORAGE_ID_KEY, next);
  return next;
}
function escapeHtml(value) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function escapeAttribute(value) {
  return escapeHtml(value);
}

// src/main.ts
var root = document.getElementById("app");
if (!root) {
  throw new Error("App root not found.");
}
mountApp(root);
