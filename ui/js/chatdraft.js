// chatdraft.js — transient composer text, kept separately for each chat
// target. This deliberately stays in memory: a draft belongs to a captain's
// current board session, but must survive moving away from and back to a chat.
export function createDraftStore() {
  const drafts = new Map();

  return {
    set(target, text) {
      if (!target) return;
      if (text) drafts.set(target, text);
      else drafts.delete(target); // clearing the field is an intentional discard
    },
    get(target) { return target ? (drafts.get(target) || '') : ''; },
  };
}
