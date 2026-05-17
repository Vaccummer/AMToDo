/** A theme node is either a color string or a nested group of nodes. */
export type ThemeNode = string | { [key: string]: ThemeNode };

export interface Theme {
  name: string;
  [group: string]: ThemeNode;
}
