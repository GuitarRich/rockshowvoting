// ---------------------------------------------------------------------------
// Where the pages talk to. The backend is now the serverless functions in
// api/, deployed alongside these pages on Vercel, so this is a same-origin
// path rather than a URL — nothing to paste in and nothing to redeploy
// separately when the code changes.
//
// Leave it empty and the ballot falls back to manual copy/paste.
// ---------------------------------------------------------------------------
window.SETLIST_API = "/api";


// The people voting, and the subset of them who are in the band. Must match
// VOTERS and BAND in setlist.js, which is what the API serves; these copies
// only exist so a page still renders with the API down.
window.SETLIST_VOTERS = ["Rich", "Ashley", "Ethan", "Justin", "Isaac", "Julie", "Organiser"];
window.SETLIST_BAND   = ["Rich", "Ashley", "Ethan", "Justin", "Isaac"];
