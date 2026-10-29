// The parts of DSH's packages this plugin uses.
//
// The host provides both packages at runtime; they are not dependencies of this repository, so
// the shapes we touch are declared here instead of pulled in. The declarations are deliberately
// narrow: what this plugin calls, nothing more.

declare module "@deepseek-ai/cordis" {
  /** The host context: the services a plugin declares through `inject`. */
  export interface Context {
    readonly tools: {
      register(definition: unknown): void;
    };
  }
}

declare module "@deepseek-ai/dsh-tools" {
  /** Build a typed tool definition from a plain one. */
  export function defineTool<T>(definition: T): T;
}
