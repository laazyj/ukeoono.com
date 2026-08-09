import site from "./site.json" with { type: "json" };

// Default slot length, used to derive an endDate so each schema.org Event has
// both bounds (Google recommends endDate for events). Free Fringe slots run
// roughly 50 minutes; a session elsewhere can override it with `minutes`.
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
        const endTotal = hour * 60 + minute + (session.minutes ?? SLOT_MINUTES);
        const endTime = `${String(Math.floor(endTotal / 60)).padStart(2, "0")}:${String(endTotal % 60).padStart(2, "0")}`;
        events.push({
          venue: venue.venue,
          address: venue.address,
          mapUrl: venue.mapUrl,
          // Both optional: `festival` overrides the Free Fringe as the parent
          // event, `ticketsUrl` marks the gig as booked ahead rather than
          // free in. They are independent, so keep them separate.
          festival: venue.festival,
          ticketsUrl: venue.ticketsUrl,
          blurb: venue.blurb,
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
