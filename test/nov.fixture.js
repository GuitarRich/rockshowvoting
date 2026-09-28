/**
 * A small two-show sheet: October on its own unprefixed tabs, November on
 * `nov·` tabs, plus the Shows registry. Enough to prove the shows stay apart.
 */
const SONG_HEAD = ["Key", "Section", "Song", "Artist", "Lead", "Length", "Energy", "Tags", "Order", "Force", "Keyboard", "Year", "Era"];
const PEOPLE = ["Name", "UpdatedAt", "AppVersion", "Count", "JSON"];

export function twoShows({ novStatus = "current", gig = "2026-11-21" } = {}) {
  return {
    Shows: [
      ["Id", "Prefix", "Name", "GigDate", "Status", "RequireBandCode"],
      ["oct", "", "October Anniversary Show", "2026-10-24", "current", "FALSE"],
      ["nov", "nov·", "Bun's & Roses", gig, novStatus, "TRUE"],
    ],
    Songs: [
      SONG_HEAD,
      ["jump-vanhalen", "Arena", "Jump", "Van Halen", "V1", "3:58", "4", "opener", "", "", "", "", ""],
      ["creep-radiohead", "LOCKED — organiser requests", "Creep", "Radiohead", "V1", "3:56", "2", "dip", "", "", "", "", ""],
    ],
    Votes: [PEOPLE],
    Learning: [PEOPLE],
    Availability: [PEOPLE],
    Settings: [["Key", "Value"], ["gigDate", "2026-10-24"]],
    "nov·Songs": [
      SONG_HEAD,
      ["riffraff-acdc", "Ballot", "Riff Raff", "AC/DC", "", "5:12", "5", "opener", "", "", "", "1978", "70s/80s"],
      ["kiss-prince", "Ballot", "Kiss", "Prince", "", "3:46", "4", "", "", "", "", "1986", "70s/80s"],
      ["freak-silverchair", "Ballot", "Freak", "Silverchair", "", "4:04", "4", "", "", "", "", "1997", "90s+"],
      ["sabotage-beastieboys", "Ballot", "Sabotage", "Beastie Boys", "", "2:58", "5", "closer", "", "", "", "1994", "90s+"],
    ],
    "nov·Votes": [PEOPLE],
    "nov·Learning": [PEOPLE],
    "nov·Availability": [PEOPLE],
    "nov·Settings": [
      ["Key", "Value"],
      ["showName", "Bun's & Roses"],
      ["bandName", "Bun's & Roses"],
      ["voters", JSON.stringify(["Rich", "Joel", "Anders", "Pete"])],
      ["band", JSON.stringify(["Rich", "Joel", "Anders", "Pete"])],
      ["maxSongs", "3"],
      ["maxPerArtist", "1"],
      ["budgetSeconds", "0"],
      ["tieBreak", "shorter"],
      ["orderEngine", "curve"],
    ],
  };
}
