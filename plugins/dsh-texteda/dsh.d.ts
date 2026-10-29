// The parts of DSH's packages this plugin uses.
//
// The host provides these packages at runtime; they are not dependencies of this repository, so
// the shapes we touch are declared here instead of pulled in. The declarations are deliberately
// narrow: what this plugin calls, nothing more.
//
// Two host halves, two surfaces: `host.ts` uses the host context's tools, sessions and connection;
// `client.ts` uses the client context's slots and tab registry, and React, which the host serves as
// a platform module. React is declared here because this repository must not depend on it — no
// `package.json` in this tree has React, and the plugin receives it from the host.
//
// `client.ts` and a `client.d.ts` cannot both exist: a declaration file next to a source file of the
// same name is dropped from the program, and the declarations silently stop applying.

declare module "react" {
  /** What a host element renders to; this plugin only creates plain elements. */
  export type ReactNode = unknown;

  /** A host element's reference: held by the app's root element. */
  export interface RefObject<T> {
    current: T | null;
  }

  /** Create one host element from a tag, props, and children. */
  export function createElement(
    type: string,
    props: { ref?: RefObject<HTMLElement | null> | null; style?: Record<string, string> } | null,
    ...children: unknown[]
  ): ReactNode;

  /** Run an effect now, and run its cleanup when the element unmounts. */
  export function useEffect(effect: () => undefined | (() => void), deps?: readonly unknown[]): void;

  /** Hold a value across renders. */
  export function useRef<T>(initial: T | null): RefObject<T>;

  /** Read and write a value across renders. */
  export function useState<T>(initial: T): [T, (next: T) => void];
}

declare module "@deepseek-ai/cordis" {
  /** A registration's lifetime: the disposer a slot or registry hands back. */
  export type Disposer = () => void;

  /** The host and client contexts: the services a plugin declares through `inject`. */
  export interface Context {
    /** Register a cleanup with this plugin's lifetime. */
    effect(callback: () => Disposer, label: string): void;
    readonly tools: {
      register(definition: unknown): void;
    };
    /** The core session store: a live session by id, for the project root it works in. */
    readonly sessions: {
      get(id: string):
        | {
            readonly header: {
              /** Absolute working directory the session was created in, when it has one. */
              readonly cwd?: string | undefined;
            };
          }
        | undefined;
    };
    /** The host's transport: exact Fetch routes below `/api`, inside its authentication fence. */
    readonly connection: {
      readonly fetch: {
        register(route: {
          readonly path: string;
          readonly methods: readonly ("GET" | "HEAD" | "POST" | "PUT" | "DELETE" | "PATCH")[];
          readonly requestBody: "buffered" | "streaming";
          readonly fetch: (request: Request) => Promise<Response>;
        }): Disposer;
      };
    };
    /** The client's slot surface: registrations dispatched by name and key. */
    readonly slots: {
      /** Run a registration while its parent slot exists. */
      inject(name: string, register: () => Disposer): Disposer;
      /** Register one occupant of a slot. */
      register(options: { name: string; key: string }, component: unknown): Disposer;
    };
    /** The client's right-sidebar tab-type registry. */
    readonly sidebarRightTabs: {
      register(definition: {
        id: string;
        kind: string;
        priority?: "extension" | "builtin" | "fallback";
        title: () => string;
        guide?: readonly {
          id: string;
          order: number;
          title: () => string;
          description?: () => string;
        }[];
      }): Disposer;
    };
  }
}

declare module "@deepseek-ai/dsh-tools" {
  /** Build a typed tool definition from a plain one. */
  export function defineTool<T>(definition: T): T;
}
