import type { CustomUI } from "dion-runtime-types/src/generated/RuntimeTypes.js";

type CustomUIMaybe = CustomUI | undefined;

function Text(text: string): CustomUI {
  return {
    type: "Text",
    text: text,
  };
}

function Timestamp(
  timestamp: string,
  display: "Relative" | "Absolute" = "Relative"
): CustomUI {
  return {
    type: "TimeStamp",
    timestamp: timestamp,
    display: display,
  };
}

type header = {
  [x: string]: string;
};
function Image(url: string, header?: header): CustomUI {
  return {
    type: "Image",
    image: url,
    header: header,
  };
}

function Link(url: string, label?: string): CustomUI {
  return {
    type: "Link",
    link: url,
    label: label,
  };
}

function Column(...children: CustomUIMaybe[]): CustomUI {
  return {
    type: "Column",
    children: children.filter((x) => x !== undefined) as CustomUI[],
  };
}

function EntryCard(centry: Entry): CustomUI {
  return {
    type: "EntryCard",
    entry: centry,
  };
}

function Row(...children: CustomUIMaybe[]): CustomUI {
  return {
    type: "Row",
    children: children.filter((x) => x !== undefined) as CustomUI[],
  };
}

function If<T extends CustomUI[] | CustomUIMaybe>(
  condition: boolean,
  ui: T
): T {
  if (condition) {
    return ui;
  }
  if (Array.isArray(ui)) {
    return [] as unknown as T;
  }
  return undefined as T;
}

export { Text, Image, EntryCard, Link, Column, Row, Timestamp, If };
