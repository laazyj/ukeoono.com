import site from "./site.json" with { type: "json" };

// Default slot length, used to derive an endDate so each schema.org Event has
// both bounds (Google recommends endDate for events). Free Fringe slots run
// roughly 50 minutes; a session elsewhere can override it with `minutes`.
const SLOT_MINUTES = 50;

// Edinburgh is on BST for half the year and GMT for the rest, and gigs land on
// both sides of the changeover, so derive the offset from the date rather than
// hand-writing one per gig.
function ukUtcOffset(date) {
  const label = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    timeZoneName: "shortOffset",
  })
    .formatToParts(new Date(`${date}T12:00:00Z`))
    .find((part) => part.type === "timeZoneName").value;
  // "GMT" in winter, "GMT+1" in summer.
  const hours = Number(label.slice(3) || 0);
  return `${hours < 0 ? "-" : "+"}${String(Math.abs(hours)).padStart(2, "0")}:00`;
}

// Stamp a local date and time as an ISO instant, with the end derived from the
// slot length unless the gig states its own finish.
function slot(date, time, endTime, minutes) {
  const offset = ukUtcOffset(date);
  if (!endTime) {
    const [hour, minute] = time.split(":").map(Number);
    const total = hour * 60 + minute + (minutes ?? SLOT_MINUTES);
    endTime = `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
  }
  return {
    startDate: `${date}T${time}:00${offset}`,
    endDate: `${date}T${endTime}:00${offset}`,
  };
}

// Flatten the venue/session/date structure in site.json into one dated event
// per gig, chronologically ordered. Drives the schema.org Event JSON-LD so
// each show is individually discoverable (Google events, etc.). The
// human-facing lists on the page render from site.lineup and site.specials
// directly.
export default function () {
  const [year, month] = site.month.split("-");
  const events = [];
  for (const venue of site.lineup) {
    for (const session of venue.sessions) {
      for (const date of session.dates) {
        const day = String(date).padStart(2, "0");
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
          ...slot(`${year}-${month}-${day}`, session.time, undefined, session.minutes),
        });
      }
    }
  }
  // Off-Fringe one-offs carry their own full date and their own parent event,
  // so they never inherit the Free Fringe framing. A Fringe run is a Festival;
  // whatever hosts a one-off may not be, so use the Event supertype there.
  for (const special of site.specials) {
    events.push({
      name: `${site.author.name} at ${special.name}`,
      venue: special.venue,
      address: special.address,
      mapUrl: special.mapUrl,
      festival: { name: special.name, url: special.promoter.url, type: "Event" },
      ticketsUrl: special.ticketsUrl,
      blurb: special.blurb,
      ...slot(special.date, special.startTime, special.endTime, special.minutes),
    });
  }
  events.sort((a, b) => a.startDate.localeCompare(b.startDate));
  return events;
}
