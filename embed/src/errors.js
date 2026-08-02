/* Every message the bundle can show, and its code, in one place.
 *
 * Errors render on the page, never only in the console. Someone who does not write code will
 * never open devtools, so anything visible only there does not exist. The support path is a
 * screenshot, which is why each message names what was received rather than only what was
 * expected, carries the docs URL, and leads with a short code: a code survives a phone photo of
 * a monitor where a sentence does not. */

export const DOCS = "https://github.com/HatmanStack/coalition-widgets";

export const CODES = {
  UNKNOWN_WIDGET: "CHC-01",
  BAD_PARAM: "CHC-02",
  FETCH_FAILED: "CHC-03",
  NO_DATA: "CHC-04",
};

const message = (code, detail) => ({ code, detail, docs: DOCS });

export const unknownWidget = (name, known) =>
  message(CODES.UNKNOWN_WIDGET, `Unknown widget ${JSON.stringify(name)}. Available: ${known.join(", ")}.`);

export const fetchFailed = (file, reason) =>
  message(CODES.FETCH_FAILED, `Could not load ${file}. ${reason}`);

export const noData = (widget, needs) =>
  message(CODES.NO_DATA, `${widget} needs ${needs}, which this payload does not carry.`);

