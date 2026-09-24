/** Sign-in portals: HQ (command) and field staff never share a sign-in page. */
export type Portal = "command" | "field";

export const PORTAL_LOGIN: Record<Portal, string> = {
  command: process.env.NEXT_PUBLIC_COMMAND_LOGIN_PATH ?? "/command/login",
  field: "/field/login",
};

const KEY = "chq.portal";

/** Remembered so an expired session sends people back to *their* sign-in page. */
export const lastPortal = (): Portal => {
  try {
    return window.localStorage.getItem(KEY) === "command" ? "command" : "field";
  } catch {
    return "field";
  }
};

export const rememberPortal = (p: Portal) => {
  try {
    window.localStorage.setItem(KEY, p);
  } catch {}
};
