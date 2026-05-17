/** A theme node is a color string, a nested group, or an array of colors. */
export type ThemeNode = string | string[] | { [key: string]: ThemeNode };

export interface Theme {
  name: string;
  [group: string]: ThemeNode;
}
