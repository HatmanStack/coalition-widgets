/* Every message the bundle can show, and its code, in one place.
 *
 * Errors render on the page, never only in the console. Someone who does not write code will
 * never open devtools, so anything visible only there does not exist. The support path is a
 * screenshot, which is why each message names what was received rather than only what was
 * expected, carries the docs URL, and leads with a short code: a code survives a phone photo of
 * a monitor where a sentence does not.
 *
 * Two rules follow from that support path, and they are why most of these take an `allowed`
 * list rather than just saying no:
 *
 * **A message must be sufficient on its own.** The reader is an LLM looking at a photograph. It
 * cannot query the catalogue, so every valid value travels in the text.
 *
 * **Nothing coerces silently.** A bad attribute used to fall back to a default, which renders
 * something plausible and produces nothing to screenshot. A widget that quietly ignores what it
 * was asked for is worse than one that refuses, because the partner never learns they were
 * ignored — they just conclude the parameter does not work. */

/* eslint-disable no-undef */
// A bare identifier, substituted by esbuild at build time — the same mechanism the data origin
// uses, and for the same reason: it must be a literal in the shipped bundle rather than
// something read from the page. Written as a string it would silently stay a string, which is
// how the data origin was broken once.
//
// It points at the help page, not the repository. Somebody clicking this from an error card is
// holding a screenshot and needs the troubleshooting instructions, not a source tree.
// The typeof guard is not defensive padding. `build.mjs` imports this module in Node to
// generate the documentation, and there the define does not exist — a bare reference throws at
// module scope and takes the build down. esbuild substitutes inside the typeof too, so the
// browser bundle still gets a literal.
export const DOCS =
  typeof __DATA_ORIGIN__ === "string" ? __DATA_ORIGIN__ : "";

export const CODES = {
  UNKNOWN_WIDGET: "CHC-01",
  BAD_PARAM: "CHC-02",
  FETCH_FAILED: "CHC-03",
  NO_DATA: "CHC-04",
  TARGET_NOT_FOUND: "CHC-05",
  TOO_NARROW: "CHC-06",
};

const message = (code, detail) => ({ code, detail, docs: DOCS });

export const unknownWidget = (name, known) =>
  message(
    CODES.UNKNOWN_WIDGET,
    `Unknown widget ${JSON.stringify(name)}. Available: ${known.join(", ")}.`,
  );

export const fetchFailed = (file, reason) =>
  message(CODES.FETCH_FAILED, `Could not load ${file}. ${reason}`);

export const noData = (widget, needs, available) =>
  message(
    CODES.NO_DATA,
    `${widget} needs ${needs}, which this payload does not carry.` +
      (available && available.length
        ? ` Available: ${available.join(", ")}.`
        : ""),
  );

export const badParam = (attr, value, allowed) =>
  message(
    CODES.BAD_PARAM,
    `${attr}=${JSON.stringify(value)} is not valid. Allowed: ${allowed.join(", ")}.`,
  );

export const missingParam = (attr, allowed) =>
  message(
    CODES.BAD_PARAM,
    `No ${attr} on the script tag. Allowed: ${allowed.join(", ")}.`,
  );

export const targetNotFound = (selector) =>
  message(
    CODES.TARGET_NOT_FOUND,
    `data-target=${JSON.stringify(selector)} matches no element on this page. Either add an ` +
      `element with that id or class, or remove data-target and the widget renders where the ` +
      `script tag sits. It has not been placed somewhere else instead, because a widget ` +
      `appearing in an unexpected spot reads as a layout bug rather than a wrong setting.`,
  );

export const tooNarrow = (width, need) =>
  message(
    CODES.TOO_NARROW,
    `This widget has ${Math.round(width)}px of width and needs at least ${need}px to stay ` +
      `readable. Give its container more room, or show fewer widgets side by side.`,
  );
