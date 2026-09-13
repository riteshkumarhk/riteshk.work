import DOMPurify from "dompurify";

const tags = ["p", "div", "ul", "ol", "li", "strong", "em", "b", "i", "s", "strike", "br", "h1", "h2", "h3", "h4", "h5", "h6", "span", "figure", "figcaption", "img", "blockquote", "hr", "a", "code", "pre", "u", "mark", "sub", "sup", "table", "thead", "tbody", "tfoot", "tr", "th", "td"];
const attributes = ["href", "src", "alt", "title", "width", "height", "loading", "target", "rel", "class", "style", "colspan", "rowspan"];
const styles = new Set(["color", "background-color", "font-family", "font-size", "font-weight", "font-style", "text-decoration", "text-align", "line-height", "letter-spacing", "vertical-align", "width", "max-width", "height", "margin", "margin-left", "margin-right", "margin-top", "margin-bottom"]);

export function sanitizeRichHtml(value, mediaUrl = value => value) {
  const fragment = DOMPurify.sanitize(String(value ?? ""), { ALLOWED_TAGS: tags, ALLOWED_ATTR: attributes, ALLOW_DATA_ATTR: false, ALLOW_ARIA_ATTR: false, RETURN_DOM_FRAGMENT: true });
  fragment.querySelectorAll("[style]").forEach(element => {
    for (const property of Array.from(element.style)) {
      if (!styles.has(property) || /url\s*\(|expression\s*\(|@import/i.test(element.style.getPropertyValue(property))) element.style.removeProperty(property);
    }
    if (!element.style.length) element.removeAttribute("style");
  });
  fragment.querySelectorAll("[src], [href]").forEach(element => {
    for (const name of ["src", "href"]) {
      const reference = element.getAttribute(name);
      if (reference && /^\/?assets\/uploads\//.test(reference)) element.setAttribute(name, mediaUrl(reference));
    }
  });
  fragment.querySelectorAll("a[target]").forEach(element => {
    if (element.getAttribute("target") === "_blank") element.setAttribute("rel", "noopener noreferrer");
    else element.removeAttribute("target");
  });
  const container = document.createElement("div");
  container.append(fragment);
  return container.innerHTML;
}