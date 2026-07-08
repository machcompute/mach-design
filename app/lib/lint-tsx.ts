import type { ParserOptions } from "@babel/parser";

export interface Diagnostic {
  severity: "error" | "warning";
  line: number;
  column: number;
  message: string;
  source: "ts" | "react-hooks" | "imports";
}

const AMBIENT = `
// ---------- primitives & global functions ----------
declare var NaN: number;
declare var Infinity: number;
declare function parseInt(string: string, radix?: number): number;
declare function parseFloat(string: string): number;
declare function isNaN(number: number): boolean;
declare function isFinite(number: number): boolean;
declare function encodeURIComponent(uriComponent: string | number | boolean): string;
declare function decodeURIComponent(encodedURIComponent: string): string;
declare function encodeURI(uri: string): string;
declare function decodeURI(encodedURI: string): string;

type PropertyKey = string | number | symbol;

interface Object {
  toString(): string;
  toLocaleString(): string;
  valueOf(): Object;
  hasOwnProperty(v: PropertyKey): boolean;
  isPrototypeOf(v: Object): boolean;
  propertyIsEnumerable(v: PropertyKey): boolean;
}
interface ObjectConstructor {
  (value?: any): any;
  new (value?: any): Object;
  keys(o: object): string[];
  values<T>(o: { [s: string]: T } | ArrayLike<T>): T[];
  values(o: {}): any[];
  entries<T>(o: { [s: string]: T } | ArrayLike<T>): [string, T][];
  entries(o: {}): [string, any][];
  assign<T extends object, U>(target: T, source: U): T & U;
  assign<T extends object, U, V>(target: T, source1: U, source2: V): T & U & V;
  assign(target: object, ...sources: any[]): any;
  freeze<T>(o: T): Readonly<T>;
  fromEntries<T = any>(entries: Iterable<readonly [PropertyKey, T]>): { [k: string]: T };
  create(o: object | null, properties?: any): any;
  defineProperty<T>(o: T, p: PropertyKey, attributes: any): T;
  getOwnPropertyNames(o: any): string[];
  getPrototypeOf(o: any): any;
  is(value1: any, value2: any): boolean;
}
declare var Object: ObjectConstructor;

interface Function {
  apply(this: Function, thisArg: any, argArray?: any): any;
  call(this: Function, thisArg: any, ...argArray: any[]): any;
  bind(this: Function, thisArg: any, ...argArray: any[]): any;
  toString(): string;
  prototype: any;
  readonly length: number;
  readonly name: string;
}
interface CallableFunction extends Function {}
interface NewableFunction extends Function {}
interface IArguments { length: number; [index: number]: any; }

// ---------- symbols & iteration protocol ----------
interface Symbol {
  toString(): string;
  valueOf(): symbol;
  readonly description: string | undefined;
}
interface SymbolConstructor {
  (description?: string | number): symbol;
  for(key: string): symbol;
  readonly iterator: unique symbol;
  readonly asyncIterator: unique symbol;
}
declare var Symbol: SymbolConstructor;

interface IteratorYieldResult<TYield> { done?: false; value: TYield; }
interface IteratorReturnResult<TReturn> { done: true; value: TReturn; }
type IteratorResult<T, TReturn = any> = IteratorYieldResult<T> | IteratorReturnResult<TReturn>;
interface Iterator<T, TReturn = any, TNext = undefined> {
  next(...args: [] | [TNext]): IteratorResult<T, TReturn>;
  return?(value?: TReturn): IteratorResult<T, TReturn>;
  throw?(e?: any): IteratorResult<T, TReturn>;
}
interface Iterable<T> { [Symbol.iterator](): Iterator<T>; }
interface IterableIterator<T> extends Iterator<T> { [Symbol.iterator](): IterableIterator<T>; }
interface AsyncIterator<T, TReturn = any, TNext = undefined> {
  next(...args: [] | [TNext]): Promise<IteratorResult<T, TReturn>>;
  return?(value?: TReturn | PromiseLike<TReturn>): Promise<IteratorResult<T, TReturn>>;
  throw?(e?: any): Promise<IteratorResult<T, TReturn>>;
}
interface AsyncIterable<T> { [Symbol.asyncIterator](): AsyncIterator<T>; }
interface AsyncIterableIterator<T> extends AsyncIterator<T> { [Symbol.asyncIterator](): AsyncIterableIterator<T>; }
interface Generator<T = unknown, TReturn = any, TNext = unknown> extends Iterator<T, TReturn, TNext> {
  next(...args: [] | [TNext]): IteratorResult<T, TReturn>;
  return(value: TReturn): IteratorResult<T, TReturn>;
  throw(e: any): IteratorResult<T, TReturn>;
  [Symbol.iterator](): Generator<T, TReturn, TNext>;
}
interface AsyncGenerator<T = unknown, TReturn = any, TNext = unknown> extends AsyncIterator<T, TReturn, TNext> {
  next(...args: [] | [TNext]): Promise<IteratorResult<T, TReturn>>;
  return(value: TReturn | PromiseLike<TReturn>): Promise<IteratorResult<T, TReturn>>;
  throw(e: any): Promise<IteratorResult<T, TReturn>>;
  [Symbol.asyncIterator](): AsyncGenerator<T, TReturn, TNext>;
}
interface GeneratorFunction extends Function {}
interface AsyncGeneratorFunction extends Function {}

// ---------- string ----------
interface String {
  readonly length: number;
  [index: number]: string;
  [Symbol.iterator](): IterableIterator<string>;
  at(index: number): string | undefined;
  charAt(pos: number): string;
  charCodeAt(index: number): number;
  codePointAt(pos: number): number | undefined;
  concat(...strings: string[]): string;
  endsWith(searchString: string, endPosition?: number): boolean;
  includes(searchString: string, position?: number): boolean;
  indexOf(searchString: string, position?: number): number;
  lastIndexOf(searchString: string, position?: number): number;
  localeCompare(that: string, locales?: any, options?: any): number;
  match(regexp: string | RegExp): RegExpMatchArray | null;
  matchAll(regexp: RegExp): IterableIterator<RegExpMatchArray>;
  normalize(form?: string): string;
  padEnd(maxLength: number, fillString?: string): string;
  padStart(maxLength: number, fillString?: string): string;
  repeat(count: number): string;
  replace(searchValue: string | RegExp, replaceValue: string): string;
  replace(searchValue: string | RegExp, replacer: (substring: string, ...args: any[]) => string): string;
  replaceAll(searchValue: string | RegExp, replaceValue: string): string;
  replaceAll(searchValue: string | RegExp, replacer: (substring: string, ...args: any[]) => string): string;
  search(regexp: string | RegExp): number;
  slice(start?: number, end?: number): string;
  split(separator: string | RegExp, limit?: number): string[];
  startsWith(searchString: string, position?: number): boolean;
  substring(start: number, end?: number): string;
  substr(from: number, length?: number): string;
  toLocaleLowerCase(locales?: any): string;
  toLocaleUpperCase(locales?: any): string;
  toLowerCase(): string;
  toUpperCase(): string;
  toString(): string;
  trim(): string;
  trimStart(): string;
  trimEnd(): string;
  valueOf(): string;
}
interface StringConstructor {
  new (value?: any): String;
  (value?: any): string;
  fromCharCode(...codes: number[]): string;
  fromCodePoint(...codePoints: number[]): string;
  raw(strings: TemplateStringsArray, ...substitutions: any[]): string;
}
declare var String: StringConstructor;
interface TemplateStringsArray extends ReadonlyArray<string> { readonly raw: readonly string[]; }

// ---------- number & boolean ----------
interface Number {
  toFixed(fractionDigits?: number): string;
  toPrecision(precision?: number): string;
  toString(radix?: number): string;
  toLocaleString(locales?: any, options?: any): string;
  valueOf(): number;
}
interface NumberConstructor {
  new (value?: any): Number;
  (value?: any): number;
  isFinite(number: unknown): boolean;
  isNaN(number: unknown): boolean;
  isInteger(number: unknown): boolean;
  isSafeInteger(number: unknown): boolean;
  parseFloat(string: string): number;
  parseInt(string: string, radix?: number): number;
  readonly MAX_SAFE_INTEGER: number;
  readonly MIN_SAFE_INTEGER: number;
  readonly MAX_VALUE: number;
  readonly MIN_VALUE: number;
  readonly EPSILON: number;
  readonly POSITIVE_INFINITY: number;
  readonly NEGATIVE_INFINITY: number;
  readonly NaN: number;
}
declare var Number: NumberConstructor;
interface Boolean { valueOf(): boolean; }
interface BooleanConstructor {
  new (value?: any): Boolean;
  <T>(value?: T): boolean;
}
declare var Boolean: BooleanConstructor;

// ---------- Math / JSON / Date ----------
interface Math {
  readonly E: number;
  readonly LN10: number;
  readonly LN2: number;
  readonly LOG2E: number;
  readonly LOG10E: number;
  readonly PI: number;
  readonly SQRT1_2: number;
  readonly SQRT2: number;
  abs(x: number): number;
  acos(x: number): number;
  asin(x: number): number;
  atan(x: number): number;
  atan2(y: number, x: number): number;
  cbrt(x: number): number;
  ceil(x: number): number;
  cos(x: number): number;
  cosh(x: number): number;
  exp(x: number): number;
  floor(x: number): number;
  hypot(...values: number[]): number;
  log(x: number): number;
  log10(x: number): number;
  log2(x: number): number;
  max(...values: number[]): number;
  min(...values: number[]): number;
  pow(x: number, y: number): number;
  random(): number;
  round(x: number): number;
  sign(x: number): number;
  sin(x: number): number;
  sinh(x: number): number;
  sqrt(x: number): number;
  tan(x: number): number;
  tanh(x: number): number;
  trunc(x: number): number;
}
declare var Math: Math;
interface JSON {
  parse(text: string, reviver?: (this: any, key: string, value: any) => any): any;
  stringify(value: any, replacer?: ((this: any, key: string, value: any) => any) | (number | string)[] | null, space?: string | number): string;
}
declare var JSON: JSON;
interface Date {
  getTime(): number;
  getFullYear(): number;
  getMonth(): number;
  getDate(): number;
  getDay(): number;
  getHours(): number;
  getMinutes(): number;
  getSeconds(): number;
  getMilliseconds(): number;
  getTimezoneOffset(): number;
  setFullYear(year: number, month?: number, date?: number): number;
  setMonth(month: number, date?: number): number;
  setDate(date: number): number;
  setHours(hours: number, min?: number, sec?: number, ms?: number): number;
  setMinutes(min: number, sec?: number, ms?: number): number;
  setSeconds(sec: number, ms?: number): number;
  setTime(time: number): number;
  toISOString(): string;
  toJSON(key?: any): string;
  toString(): string;
  toDateString(): string;
  toTimeString(): string;
  toLocaleDateString(locales?: any, options?: any): string;
  toLocaleTimeString(locales?: any, options?: any): string;
  toLocaleString(locales?: any, options?: any): string;
  valueOf(): number;
}
interface DateConstructor {
  new (): Date;
  new (value: number | string | Date): Date;
  new (year: number, monthIndex: number, date?: number, hours?: number, minutes?: number, seconds?: number, ms?: number): Date;
  (): string;
  now(): number;
  parse(s: string): number;
  UTC(year: number, monthIndex?: number, date?: number, hours?: number, minutes?: number, seconds?: number, ms?: number): number;
  readonly prototype: Date;
}
declare var Date: DateConstructor;

// ---------- arrays ----------
interface ArrayLike<T> { readonly length: number; readonly [n: number]: T; }
interface Array<T> {
  length: number;
  [n: number]: T;
  [Symbol.iterator](): IterableIterator<T>;
  at(index: number): T | undefined;
  concat(...items: (T | T[])[]): T[];
  entries(): IterableIterator<[number, T]>;
  every(predicate: (value: T, index: number, array: T[]) => unknown): boolean;
  fill(value: T, start?: number, end?: number): this;
  filter<S extends T>(predicate: (value: T, index: number, array: T[]) => value is S): S[];
  filter(predicate: (value: T, index: number, array: T[]) => unknown): T[];
  find<S extends T>(predicate: (value: T, index: number, array: T[]) => value is S): S | undefined;
  find(predicate: (value: T, index: number, array: T[]) => unknown): T | undefined;
  findIndex(predicate: (value: T, index: number, array: T[]) => unknown): number;
  findLast(predicate: (value: T, index: number, array: T[]) => unknown): T | undefined;
  findLastIndex(predicate: (value: T, index: number, array: T[]) => unknown): number;
  flat<U>(this: U[][], depth?: 1): U[];
  flat(depth?: number): any[];
  flatMap<U>(callback: (value: T, index: number, array: T[]) => U | readonly U[]): U[];
  forEach(callbackfn: (value: T, index: number, array: T[]) => void): void;
  includes(searchElement: T, fromIndex?: number): boolean;
  indexOf(searchElement: T, fromIndex?: number): number;
  join(separator?: string): string;
  keys(): IterableIterator<number>;
  lastIndexOf(searchElement: T, fromIndex?: number): number;
  map<U>(callbackfn: (value: T, index: number, array: T[]) => U): U[];
  pop(): T | undefined;
  push(...items: T[]): number;
  reduce(callbackfn: (previousValue: T, currentValue: T, currentIndex: number, array: T[]) => T): T;
  reduce(callbackfn: (previousValue: T, currentValue: T, currentIndex: number, array: T[]) => T, initialValue: T): T;
  reduce<U>(callbackfn: (previousValue: U, currentValue: T, currentIndex: number, array: T[]) => U, initialValue: U): U;
  reduceRight(callbackfn: (previousValue: T, currentValue: T, currentIndex: number, array: T[]) => T): T;
  reduceRight<U>(callbackfn: (previousValue: U, currentValue: T, currentIndex: number, array: T[]) => U, initialValue: U): U;
  reverse(): T[];
  shift(): T | undefined;
  slice(start?: number, end?: number): T[];
  some(predicate: (value: T, index: number, array: T[]) => unknown): boolean;
  sort(compareFn?: (a: T, b: T) => number): this;
  splice(start: number, deleteCount?: number, ...items: T[]): T[];
  toString(): string;
  unshift(...items: T[]): number;
  values(): IterableIterator<T>;
}
interface ReadonlyArray<T> {
  readonly length: number;
  readonly [n: number]: T;
  [Symbol.iterator](): IterableIterator<T>;
  at(index: number): T | undefined;
  concat(...items: (T | T[])[]): T[];
  entries(): IterableIterator<[number, T]>;
  every(predicate: (value: T, index: number, array: readonly T[]) => unknown): boolean;
  filter(predicate: (value: T, index: number, array: readonly T[]) => unknown): T[];
  find(predicate: (value: T, index: number, array: readonly T[]) => unknown): T | undefined;
  findIndex(predicate: (value: T, index: number, array: readonly T[]) => unknown): number;
  findLast(predicate: (value: T, index: number, array: readonly T[]) => unknown): T | undefined;
  findLastIndex(predicate: (value: T, index: number, array: readonly T[]) => unknown): number;
  flat(depth?: number): any[];
  flatMap<U>(callback: (value: T, index: number, array: readonly T[]) => U | readonly U[]): U[];
  forEach(callbackfn: (value: T, index: number, array: readonly T[]) => void): void;
  includes(searchElement: T, fromIndex?: number): boolean;
  indexOf(searchElement: T, fromIndex?: number): number;
  join(separator?: string): string;
  keys(): IterableIterator<number>;
  lastIndexOf(searchElement: T, fromIndex?: number): number;
  map<U>(callbackfn: (value: T, index: number, array: readonly T[]) => U): U[];
  reduce(callbackfn: (previousValue: T, currentValue: T, currentIndex: number, array: readonly T[]) => T): T;
  reduce<U>(callbackfn: (previousValue: U, currentValue: T, currentIndex: number, array: readonly T[]) => U, initialValue: U): U;
  reduceRight(callbackfn: (previousValue: T, currentValue: T, currentIndex: number, array: readonly T[]) => T): T;
  reduceRight<U>(callbackfn: (previousValue: U, currentValue: T, currentIndex: number, array: readonly T[]) => U, initialValue: U): U;
  slice(start?: number, end?: number): T[];
  some(predicate: (value: T, index: number, array: readonly T[]) => unknown): boolean;
  values(): IterableIterator<T>;
}
interface ArrayConstructor {
  new <T = any>(arrayLength?: number): T[];
  new <T>(...items: T[]): T[];
  <T = any>(arrayLength?: number): T[];
  <T>(...items: T[]): T[];
  isArray(arg: any): arg is any[];
  from<T>(iterable: Iterable<T> | ArrayLike<T>): T[];
  from<T, U>(iterable: Iterable<T> | ArrayLike<T>, mapfn: (v: T, k: number) => U): U[];
  of<T>(...items: T[]): T[];
  readonly prototype: any[];
}
declare var Array: ArrayConstructor;

// ---------- Map / Set ----------
interface Map<K, V> {
  readonly size: number;
  get(key: K): V | undefined;
  set(key: K, value: V): this;
  has(key: K): boolean;
  delete(key: K): boolean;
  clear(): void;
  forEach(callbackfn: (value: V, key: K, map: Map<K, V>) => void): void;
  keys(): IterableIterator<K>;
  values(): IterableIterator<V>;
  entries(): IterableIterator<[K, V]>;
  [Symbol.iterator](): IterableIterator<[K, V]>;
}
interface MapConstructor {
  new <K = any, V = any>(entries?: readonly (readonly [K, V])[] | Iterable<readonly [K, V]> | null): Map<K, V>;
  readonly prototype: Map<any, any>;
}
declare var Map: MapConstructor;
interface Set<T> {
  readonly size: number;
  add(value: T): this;
  has(value: T): boolean;
  delete(value: T): boolean;
  clear(): void;
  forEach(callbackfn: (value: T, value2: T, set: Set<T>) => void): void;
  keys(): IterableIterator<T>;
  values(): IterableIterator<T>;
  entries(): IterableIterator<[T, T]>;
  [Symbol.iterator](): IterableIterator<T>;
}
interface SetConstructor {
  new <T = any>(values?: readonly T[] | Iterable<T> | null): Set<T>;
  readonly prototype: Set<any>;
}
declare var Set: SetConstructor;
interface WeakMap<K extends object, V> {
  get(key: K): V | undefined;
  set(key: K, value: V): this;
  has(key: K): boolean;
  delete(key: K): boolean;
}
interface WeakMapConstructor { new <K extends object = object, V = any>(entries?: readonly (readonly [K, V])[] | null): WeakMap<K, V>; }
declare var WeakMap: WeakMapConstructor;
interface WeakSet<T extends object> {
  add(value: T): this;
  has(value: T): boolean;
  delete(value: T): boolean;
}
interface WeakSetConstructor { new <T extends object = object>(values?: readonly T[] | null): WeakSet<T>; }
declare var WeakSet: WeakSetConstructor;

// ---------- RegExp ----------
interface RegExp {
  test(string: string): boolean;
  exec(string: string): RegExpExecArray | null;
  lastIndex: number;
  readonly source: string;
  readonly flags: string;
  readonly global: boolean;
  readonly ignoreCase: boolean;
  readonly multiline: boolean;
  toString(): string;
}
interface RegExpMatchArray extends Array<string> {
  index?: number;
  input?: string;
  groups?: { [key: string]: string };
}
interface RegExpExecArray extends Array<string> {
  index: number;
  input: string;
  groups?: { [key: string]: string };
}
interface RegExpConstructor {
  new (pattern: RegExp | string, flags?: string): RegExp;
  (pattern: RegExp | string, flags?: string): RegExp;
  readonly prototype: RegExp;
}
declare var RegExp: RegExpConstructor;

// ---------- errors ----------
interface Error { name: string; message: string; stack?: string; cause?: unknown; }
interface ErrorConstructor {
  new (message?: string, options?: { cause?: unknown }): Error;
  (message?: string, options?: { cause?: unknown }): Error;
  readonly prototype: Error;
}
declare var Error: ErrorConstructor;
declare var TypeError: ErrorConstructor;
declare var RangeError: ErrorConstructor;
declare var SyntaxError: ErrorConstructor;
declare var ReferenceError: ErrorConstructor;
declare var EvalError: ErrorConstructor;

// ---------- promises ----------
interface Promise<T> {
  then<TResult1 = T, TResult2 = never>(
    onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2>;
  catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | null): Promise<T | TResult>;
  finally(onfinally?: (() => void) | null): Promise<T>;
}
interface PromiseLike<T> {
  then<TResult1 = T, TResult2 = never>(
    onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2>;
}
interface PromiseFulfilledResult<T> { status: "fulfilled"; value: T; }
interface PromiseRejectedResult { status: "rejected"; reason: any; }
type PromiseSettledResult<T> = PromiseFulfilledResult<T> | PromiseRejectedResult;
interface PromiseConstructor {
  new <T>(executor: (resolve: (value: T | PromiseLike<T>) => void, reject: (reason?: any) => void) => void): Promise<T>;
  resolve(): Promise<void>;
  resolve<T>(value: T | PromiseLike<T>): Promise<T>;
  reject<T = never>(reason?: any): Promise<T>;
  all<T extends readonly unknown[] | []>(values: T): Promise<{ -readonly [P in keyof T]: Awaited<T[P]> }>;
  all<T>(values: Iterable<T | PromiseLike<T>>): Promise<Awaited<T>[]>;
  allSettled<T extends readonly unknown[] | []>(values: T): Promise<{ -readonly [P in keyof T]: PromiseSettledResult<Awaited<T[P]>> }>;
  allSettled<T>(values: Iterable<T | PromiseLike<T>>): Promise<PromiseSettledResult<Awaited<T>>[]>;
  race<T extends readonly unknown[] | []>(values: T): Promise<Awaited<T[number]>>;
  race<T>(values: Iterable<T | PromiseLike<T>>): Promise<Awaited<T>>;
  readonly prototype: Promise<any>;
}
declare var Promise: PromiseConstructor;

// ---------- utility types ----------
type Awaited<T> = T extends null | undefined ? T : T extends object & { then(onfulfilled: infer F, ...args: infer _): any } ? (F extends (value: infer V, ...args: infer _) => any ? Awaited<V> : never) : T;
type Partial<T> = { [P in keyof T]?: T[P] };
type Required<T> = { [P in keyof T]-?: T[P] };
type Readonly<T> = { readonly [P in keyof T]: T[P] };
type Pick<T, K extends keyof T> = { [P in K]: T[P] };
type Exclude<T, U> = T extends U ? never : T;
type Extract<T, U> = T extends U ? T : never;
type Omit<T, K extends keyof any> = Pick<T, Exclude<keyof T, K>>;
type NonNullable<T> = T extends null | undefined ? never : T;
type Record<K extends keyof any, T> = { [P in K]: T };
type Parameters<T extends (...args: any) => any> = T extends (...args: infer P) => any ? P : never;
type ConstructorParameters<T extends abstract new (...args: any) => any> = T extends abstract new (...args: infer P) => any ? P : never;
type ReturnType<T extends (...args: any) => any> = T extends (...args: any) => infer R ? R : any;
type InstanceType<T extends abstract new (...args: any) => any> = T extends abstract new (...args: any) => infer R ? R : any;
type Uppercase<S extends string> = S;
type Lowercase<S extends string> = S;
type Capitalize<S extends string> = S;
type Uncapitalize<S extends string> = S;
interface ThisType<T> {}

// ---------- host environment ----------
interface Console {
  log(...data: any[]): void;
  warn(...data: any[]): void;
  error(...data: any[]): void;
  info(...data: any[]): void;
  debug(...data: any[]): void;
  trace(...data: any[]): void;
  table(tabularData?: any, properties?: string[]): void;
  group(...data: any[]): void;
  groupCollapsed(...data: any[]): void;
  groupEnd(): void;
  time(label?: string): void;
  timeEnd(label?: string): void;
  count(label?: string): void;
  assert(condition?: boolean, ...data: any[]): void;
  dir(item?: any, options?: any): void;
}
declare var console: Console;
declare function setTimeout(handler: (...args: any[]) => void, timeout?: number, ...args: any[]): number;
declare function clearTimeout(id: number | undefined): void;
declare function setInterval(handler: (...args: any[]) => void, timeout?: number, ...args: any[]): number;
declare function clearInterval(id: number | undefined): void;
declare function queueMicrotask(callback: () => void): void;
declare function structuredClone<T>(value: T, options?: any): T;
declare function requestAnimationFrame(callback: (time: number) => void): number;
declare function cancelAnimationFrame(handle: number): void;
declare function atob(data: string): string;
declare function btoa(data: string): string;
declare function alert(message?: any): void;
declare function confirm(message?: string): boolean;
declare function prompt(message?: string, defaultValue?: string): string | null;
declare var performance: { now(): number; mark(name: string): void; measure(name: string, start?: string, end?: string): void; [key: string]: any };
declare var crypto: { randomUUID(): string; getRandomValues(array: any): any; subtle: any; [key: string]: any };
declare function fetch(input: string, init?: any): Promise<any>;
declare var window: any;
declare var document: any;
declare var navigator: any;
declare var localStorage: any;
declare var sessionStorage: any;
interface Event { target: any; currentTarget: any; preventDefault(): void; stopPropagation(): void; }
declare var Event: { new (type: string, eventInitDict?: any): Event; prototype: Event };
declare var CustomEvent: { new (type: string, eventInitDict?: any): Event; prototype: Event };
interface HTMLElement {
  style: any;
  className: string;
  id: string;
  textContent: string | null;
  innerHTML: string;
  offsetWidth: number;
  offsetHeight: number;
  clientWidth: number;
  clientHeight: number;
  scrollTop: number;
  scrollLeft: number;
  scrollHeight: number;
  scrollWidth: number;
  dataset: { [key: string]: string | undefined };
  focus(): void;
  blur(): void;
  click(): void;
  contains(other: any): boolean;
  getBoundingClientRect(): { top: number; left: number; right: number; bottom: number; width: number; height: number; x: number; y: number };
  scrollIntoView(options?: any): void;
  addEventListener(type: string, listener: (event: any) => void, options?: any): void;
  removeEventListener(type: string, listener: (event: any) => void, options?: any): void;
  querySelector(selectors: string): HTMLElement | null;
  querySelectorAll(selectors: string): HTMLElement[];
}
interface HTMLDivElement extends HTMLElement {}
interface HTMLSpanElement extends HTMLElement {}
interface HTMLParagraphElement extends HTMLElement {}
interface HTMLHeadingElement extends HTMLElement {}
interface HTMLUListElement extends HTMLElement {}
interface HTMLLIElement extends HTMLElement {}
interface HTMLInputElement extends HTMLElement { value: string; checked: boolean; type: string; placeholder: string; disabled: boolean; select(): void; }
interface HTMLTextAreaElement extends HTMLElement { value: string; placeholder: string; disabled: boolean; select(): void; }
interface HTMLSelectElement extends HTMLElement { value: string; disabled: boolean; }
interface HTMLButtonElement extends HTMLElement { disabled: boolean; type: string; }
interface HTMLFormElement extends HTMLElement { reset(): void; submit(): void; }
interface HTMLAnchorElement extends HTMLElement { href: string; target: string; }
interface HTMLImageElement extends HTMLElement { src: string; alt: string; width: number; height: number; }
interface HTMLCanvasElement extends HTMLElement { width: number; height: number; getContext(contextId: string, options?: any): any; toDataURL(type?: string, quality?: any): string; }
interface HTMLVideoElement extends HTMLElement { src: string; currentTime: number; duration: number; muted: boolean; paused: boolean; play(): Promise<void>; pause(): void; }
interface HTMLAudioElement extends HTMLVideoElement {}
declare namespace JSX {
  interface IntrinsicElements { [e: string]: any; }
  interface Element {}
  interface ElementClass {}
  interface IntrinsicAttributes { key?: string | number | null; ref?: any; }
  interface ElementChildrenAttribute { children: {}; }
}
declare const React: any;
declare module "react" {
  export type SetState<S> = (v: S | ((p: S) => S)) => void;
  export function useState<S>(initial: S | (() => S)): [S, SetState<S>];
  export function useEffect(fn: () => void | (() => void), deps?: any[]): void;
  export function useLayoutEffect(fn: () => void | (() => void), deps?: any[]): void;
  export function useRef<T>(initial: T): { current: T };
  export function useMemo<T>(fn: () => T, deps: any[]): T;
  export function useCallback<T extends (...a: any[]) => any>(fn: T, deps: any[]): T;
  export function useReducer(reducer: any, initial: any, init?: any): [any, (action: any) => void];
  export function useContext<T>(ctx: any): T;
  export function createContext<T>(value: T): any;
  export const Fragment: any;
  const React: any;
  export default React;
}
declare module "react-dom/client";
declare module "lucide-react";
`;

// ---- TypeScript pass (in-browser language service) ----

type TsEnv = {
  updateFile: (name: string, content: string) => void;
  languageService: {
    getSemanticDiagnostics: (name: string) => unknown[];
    getSyntacticDiagnostics: (name: string) => unknown[];
  };
};

type TsModule = typeof import("typescript");

let tsEnvPromise: Promise<{ env: TsEnv; ts: TsModule }> | null = null;

async function getTsEnv() {
  if (!tsEnvPromise) {
    const promise = (async () => {
      const ts = ((await import("typescript")) as { default?: TsModule }).default ?? (await import("typescript"));
      const vfs = await import("@typescript/vfs");

      const compilerOptions = {
        target: ts.ScriptTarget.ES2020,
        jsx: ts.JsxEmit.React,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        noLib: true,
        esModuleInterop: true,
        skipLibCheck: true,
        strict: false,
        noEmit: true,
        allowJs: true,
        noUnusedLocals: true,
        noUnusedParameters: true,
      };

      const fsMap = new Map<string, string>();
      fsMap.set("/globals.d.ts", AMBIENT);
      fsMap.set("/App.tsx", "export {};");

      const system = vfs.createSystem(fsMap);
      const env = vfs.createVirtualTypeScriptEnvironment(system, ["/App.tsx", "/globals.d.ts"], ts, compilerOptions);
      return { env: env as unknown as TsEnv, ts: ts as TsModule };
    })();
    // Reset on failure so a transient module/init error can be retried on the next lint.
    promise.catch(() => { tsEnvPromise = null; });
    tsEnvPromise = promise;
  }
  return tsEnvPromise;
}

const LINT_UNAVAILABLE: Diagnostic = {
  severity: "warning",
  line: 1,
  column: 1,
  message: "Type checker unavailable — could not initialize TypeScript. Type errors won't be reported.",
  source: "ts",
};

async function tsDiagnostics(code: string): Promise<Diagnostic[]> {
  let env: TsEnv, ts: TsModule;
  try {
    ({ env, ts } = await getTsEnv());
  } catch {
    return [LINT_UNAVAILABLE];
  }
  try {
    env.updateFile("/App.tsx", code);
    const raw = [
      ...env.languageService.getSemanticDiagnostics("/App.tsx"),
      ...env.languageService.getSyntacticDiagnostics("/App.tsx"),
    ] as import("typescript").Diagnostic[];

    return raw
      .filter((d) => d.category === ts.DiagnosticCategory.Error || d.category === ts.DiagnosticCategory.Warning)
      .map((d) => {
        const pos = d.file && d.start != null ? d.file.getLineAndCharacterOfPosition(d.start) : { line: 0, character: 0 };
        return {
          severity: d.category === ts.DiagnosticCategory.Error ? "error" : "warning",
          line: pos.line + 1,
          column: pos.character + 1,
          message: ts.flattenDiagnosticMessageText(d.messageText, "\n"),
          source: "ts",
        } as Diagnostic;
      });
  } catch {
    return [];
  }
}

// ---- React hooks pass (rules-of-hooks via Babel AST) ----

const PARSE_OPTIONS: ParserOptions = { sourceType: "module", plugins: ["typescript", "jsx"] };

const FUNCTION_TYPES = new Set([
  "FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression",
  "ObjectMethod", "ClassMethod", "ClassPrivateMethod",
]);

const CONDITIONAL_TYPES = new Set([
  "IfStatement", "ConditionalExpression", "LogicalExpression",
  "ForStatement", "ForInStatement", "ForOfStatement",
  "WhileStatement", "DoWhileStatement", "SwitchStatement", "SwitchCase",
  "TryStatement", "CatchClause",
]);

interface Loc { line: number; column: number }
interface AstNode { type: string; loc?: { start: Loc }; callee?: AstNode; property?: AstNode; name?: string; [k: string]: unknown }

function isHookCallee(callee: AstNode | undefined): boolean {
  if (!callee) return false;
  if (callee.type === "Identifier" && /^use[A-Z]/.test(callee.name ?? "")) return true;
  if (callee.type === "MemberExpression") {
    const prop = callee.property as AstNode | undefined;
    return prop?.type === "Identifier" && /^use[A-Z]/.test(prop.name ?? "");
  }
  return false;
}

async function hooksDiagnostics(code: string): Promise<Diagnostic[]> {
  try {
    const { parse } = await import("@babel/parser");
    const ast = parse(code, PARSE_OPTIONS);
    const out: Diagnostic[] = [];

    function visit(node: AstNode, ancestors: AstNode[]) {
      if (node.type === "CallExpression" && isHookCallee(node.callee as AstNode)) {
        let funcIdx = -1;
        for (let i = ancestors.length - 1; i >= 0; i--) {
          if (FUNCTION_TYPES.has(ancestors[i].type)) { funcIdx = i; break; }
        }
        const pos = node.loc?.start ?? { line: 1, column: 0 };
        const at = { line: pos.line, column: pos.column + 1 };
        if (funcIdx === -1) {
          out.push({ severity: "error", ...at, source: "react-hooks", message: 'React Hook is called outside of a component or custom Hook.' });
        } else {
          const between = ancestors.slice(funcIdx + 1).some((a) => CONDITIONAL_TYPES.has(a.type));
          if (between) {
            out.push({ severity: "error", ...at, source: "react-hooks", message: 'React Hook is called conditionally. Hooks must run in the same order on every render.' });
          }
        }
      }

      const next = [...ancestors, node];
      for (const key in node) {
        if (key === "loc" || key === "start" || key === "end" || key === "leadingComments" || key === "trailingComments") continue;
        const child = node[key];
        if (Array.isArray(child)) {
          for (const c of child) if (c && typeof c === "object" && typeof (c as AstNode).type === "string") visit(c as AstNode, next);
        } else if (child && typeof child === "object" && typeof (child as AstNode).type === "string") {
          visit(child as AstNode, next);
        }
      }
    }

    visit(ast.program as unknown as AstNode, []);
    return out;
  } catch {
    return [];
  }
}

// ---- Runtime import pass (named exports that TS ambient modules cannot catch) ----

let lucideExportsPromise: Promise<Set<string>> | null = null;

async function getLucideExports(): Promise<Set<string>> {
  if (!lucideExportsPromise) {
    lucideExportsPromise = import("lucide-react")
      .then((mod) => new Set(Object.keys(mod)))
      .catch((e) => {
        lucideExportsPromise = null;
        throw e;
      });
  }
  return lucideExportsPromise;
}

function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => {
    const row = new Array<number>(b.length + 1).fill(0);
    row[0] = i;
    return row;
  });
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  return dp[a.length][b.length];
}

function nearestExport(name: string, exports: Set<string>): string | null {
  const normalized = name.toLowerCase();
  const substringMatches = [...exports]
    .filter((key) => key.toLowerCase().includes(normalized))
    .sort((a, b) => a.length - b.length || editDistance(normalized, a.toLowerCase()) - editDistance(normalized, b.toLowerCase()));
  if (substringMatches[0]) return substringMatches[0];

  const candidates = [...exports].filter((key) => {
    const k = key.toLowerCase();
    return normalized.includes(k) || k[0] === normalized[0];
  });
  let best: { name: string; distance: number } | null = null;
  for (const candidate of candidates) {
    const distance = editDistance(normalized, candidate.toLowerCase());
    if (!best || distance < best.distance) best = { name: candidate, distance };
  }
  return best && best.distance <= Math.max(3, Math.ceil(name.length * 0.7)) ? best.name : null;
}

async function importDiagnostics(code: string): Promise<Diagnostic[]> {
  try {
    const { parse } = await import("@babel/parser");
    const ast = parse(code, PARSE_OPTIONS);
    const lucideExports = await getLucideExports();
    const out: Diagnostic[] = [];

    for (const node of ast.program.body) {
      if (node.type !== "ImportDeclaration" || node.source.value !== "lucide-react") continue;
      for (const spec of node.specifiers) {
        if (spec.type === "ImportNamespaceSpecifier") continue;

        const imported =
          spec.type === "ImportDefaultSpecifier"
            ? "default"
            : spec.imported.type === "Identifier"
              ? spec.imported.name
              : spec.imported.value;

        if (lucideExports.has(imported)) continue;

        const pos = spec.loc?.start ?? node.loc?.start ?? { line: 1, column: 0 };
        const suggestion = nearestExport(imported, lucideExports);
        out.push({
          severity: "error",
          line: pos.line,
          column: pos.column + 1,
          source: "imports",
          message: suggestion
            ? `lucide-react does not export "${imported}". Did you mean "${suggestion}"?`
            : `lucide-react does not export "${imported}".`,
        });
      }
    }

    return out;
  } catch {
    return [];
  }
}

export async function lintTsx(code: string): Promise<Diagnostic[]> {
  if (!code.trim()) return [];
  const [ts, hooks, imports] = await Promise.all([
    tsDiagnostics(code),
    hooksDiagnostics(code),
    importDiagnostics(code),
  ]);
  return [...ts, ...hooks, ...imports].sort((a, b) => a.line - b.line || a.column - b.column);
}
