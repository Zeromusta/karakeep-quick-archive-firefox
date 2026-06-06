import {
  addBookmarkToList,
  getBookmarkLists,
  getLists,
  removeBookmarkFromList
} from "./karakeep-client.js";

// List-membership operations against Karakeep, shared by the popup picker and
// the keyboard-shortcut overlay. Mirrors Shared/Services/ListService.swift from
// the iOS app: surfaces errors as messages rather than throwing, so callers can
// render them inline.

function isManualList(list) {
  // Only manual lists accept manual bookmark adds — smart lists are query-driven.
  return Boolean(list) && list.type === "manual";
}

function errorMessage(error) {
  return error instanceof Error && error.message
    ? error.message
    : "Karakeep returned an error";
}

// Fetches the manual lists and, when bookmarkId is given, which of them already
// contain the bookmark. The two calls run concurrently. memberListIds is a plain
// array (not a Set) so it survives runtime-message serialization.
export async function fetchListsWithMembership(bookmarkId) {
  try {
    const [allLists, memberLists] = await Promise.all([
      getLists(),
      bookmarkId ? getBookmarkLists(bookmarkId) : Promise.resolve([])
    ]);
    return {
      ok: true,
      lists: allLists.filter(isManualList),
      memberListIds: memberLists.map((list) => list.id),
      message: null
    };
  } catch (error) {
    return {
      ok: false,
      lists: [],
      memberListIds: [],
      message: errorMessage(error)
    };
  }
}

// Adds (member = true) or removes (member = false) the bookmark from a list.
export async function setMembership(bookmarkId, listId, member) {
  try {
    if (member) {
      await addBookmarkToList(bookmarkId, listId);
    } else {
      await removeBookmarkFromList(bookmarkId, listId);
    }
    return { ok: true, message: null };
  } catch (error) {
    return { ok: false, message: errorMessage(error) };
  }
}
