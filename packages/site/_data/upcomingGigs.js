import site from "./site.json" with { type: "json" };

// A gig without a stated finish is assumed to run about an hour. Only used to
// give each schema.org Event an endDate (Google recommends one).
const DEFAULT_MINUTES = 60;

// Edinburgh is on BST for half the year and GMT for the rest, and gigs land on
// both sides of the changeover, so derive the offset from the date rather than
// hand-writing one per gig.
const londonOffset = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  timeZoneName: "shortOffset",
});

function ukUtcOffset(date) {
  const label = londonOffset
    .formatToParts(new Date(`${date}T12:00:00Z`))
    .find((part) => part.type === "timeZoneName").value;
  // "GMT" in winter, "GMT+1" in summer.
  const hours = Number(label.slice(3) || 0);
  return `${hours < 0 ? "-" : "+"}${String(Math.abs(hours)).padStart(2, "0")}:00`;
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "Wed" and "30 Sep" for the card's date bar. Spelled out by hand because
// en-GB Intl formatting abbreviates September to "Sept".
function dateLabels(date) {
  const d = new Date(`${date}T12:00:00Z`);
  return {
    dayLabel: DAYS[d.getUTCDay()],
    dateLabel: `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`,
  };
}

// Start and end instants for a gig's schema.org Event JSON-LD.
function eventTimes(gig) {
  const offset = ukUtcOffset(gig.date);
  const startDate = `${gig.date}T${gig.startTime}:00${offset}`;
  const start = Date.parse(startDate);
  let end = gig.endTime
    ? Date.parse(`${gig.date}T${gig.endTime}:00${offset}`)
    : start + DEFAULT_MINUTES * 60_000;
  // A finish at or before the start ("20:00–01:00") is after midnight.
  if (end <= start) end += 24 * 60 * 60_000;
  return { startDate, endDate: new Date(end).toISOString() };
}

// A private gig (a wedding, say) has no public time, so it sorts last on its day.
const sortKey = (gig) => `${gig.date}T${gig.startTime ?? "24:00"}`;

// The gigs in site.json, in date order, with display labels and, for public
// gigs, ISO start/end instants. Nothing expires on its own: a gig stays on the
// home page until it's removed from site.json.
export default function () {
  return site.gigs
    .map((gig) => ({
      ...gig,
      ...dateLabels(gig.date),
      ...(gig.startTime && {
        timeLabel: gig.endTime ? `${gig.startTime}–${gig.endTime}` : gig.startTime,
        ...eventTimes(gig),
      }),
    }))
    .sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
}
