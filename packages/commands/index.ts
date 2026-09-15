import type { Action } from "../editor-core/engine";
export class CommandRegistry {
  private commands = new Map<string, Action>();
  register(actions: Action[]): void {
    for (const action of actions) this.commands.set(action.id, action);
  }
  list(): Action[] {
    return [...this.commands.values()];
  }
  get(id: string): Action | undefined {
    return this.commands.get(id);
  }
  async execute(id: string, value?: string): Promise<void> {
    const action = this.commands.get(id);
    if (action && action.available?.() !== false) await action.execute(value);
  }
}
export function shortcutMatches(
  event: KeyboardEvent,
  shortcut: string,
): boolean {
  const keys = shortcut.toLowerCase().split("+");
  const key = keys.at(-1);
  return (
    event.key.toLowerCase() === key &&
    !!(event.ctrlKey || event.metaKey) === keys.includes("ctrl") &&
    event.shiftKey === keys.includes("shift") &&
    event.altKey === keys.includes("alt")
  );
}
