// URL hash segments are percent-encoded, but a hand-edited hash can contain
// an invalid escape such as `%zz`. decodeURIComponent throws on those; keeping
// the raw segment lets the router reject the id and redirect instead of
// letting a URIError escape from the hashchange listener.
export function decodeHashPart(value) {
  if (value == null) return value;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
