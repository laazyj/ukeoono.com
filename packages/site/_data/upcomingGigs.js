import site from "./site.json" with { type: "json" };

// A gig without a stated finish is assumed to run about an hour. Only used to
// give each schema.org Event an endDate (Google recommends one) and to decide
// when a gig has finished.
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

// The gigs in site.json that haven't finished yet, in date order, with ISO
// start/end instants (for the schema.org Event JSON-LD) and display labels.
// "Now" is the build time, so a gig drops off at the first build after it
// ends; the deploy workflow rebuilds daily as well as on every merge.
export default function () {
  const now = Date.now();
  return site.gigs
    .map((gig) => {
      const offset = ukUtcOffset(gig.date);
      const startDate = `${gig.date}T${gig.startTime}:00${offset}`;
      const start = Date.parse(startDate);
      let end = gig.endTime
        ? Date.parse(`${gig.date}T${gig.endTime}:00${offset}`)
        : start + DEFAULT_MINUTES * 60_000;
      // A finish at or before the start ("20:00–01:00") is after midnight.
      if (end <= start) end += 24 * 60 * 60_000;
      return {
        ...gig,
        ...dateLabels(gig.date),
        timeLabel: gig.endTime ? `${gig.startTime}–${gig.endTime}` : gig.startTime,
        startDate,
        endDate: new Date(end).toISOString(),
      };
    })
    .filter((gig) => Date.parse(gig.endDate) > now)
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
}
