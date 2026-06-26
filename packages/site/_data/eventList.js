import site from "./site.json" with { type: "json" };

// Free Fringe slots run roughly 50 minutes; used to derive an endDate so each
// schema.org Event has both bounds (Google recommends endDate for events).
const SLOT_MINUTES = 50;

// Flatten the venue/session/date structure in site.json into one dated event
// per gig, chronologically ordered. Drives the schema.org Event JSON-LD so
// each Fringe show is individually discoverable (Google events, etc.). The
// human-facing list on the page renders from site.lineup directly.
export default function () {
  const [year, month] = site.month.split("-");
  const events = [];
  for (const venue of site.lineup) {
    for (const session of venue.sessions) {
      for (const date of session.dates) {
        const day = String(date).padStart(2, "0");
        const [hour, minute] = session.time.split(":").map(Number);
        const endTotal = hour * 60 + minute + SLOT_MINUTES;
        const endTime = `${String(Math.floor(endTotal / 60)).padStart(2, "0")}:${String(endTotal % 60).padStart(2, "0")}`;
        events.push({
          venue: venue.venue,
          address: venue.address,
          mapUrl: venue.mapUrl,
          // Edinburgh is on BST (UTC+1) throughout August.
          startDate: `${year}-${month}-${day}T${session.time}:00+01:00`,
          endDate: `${year}-${month}-${day}T${endTime}:00+01:00`,
        });
      }
    }
  }
  events.sort((a, b) => a.startDate.localeCompare(b.startDate));
  return events;
}
