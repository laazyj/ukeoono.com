export default {
  layout: "layouts/back-catalogue-entry.njk",
  permalink: "/back-catalogue/{{ page.fileSlug }}/",
  wide: true,
  eleventyComputed: {
    // Where an entry's exported photos live: <n>.jpg and <n>-thumb.jpg.
    photoBase: (data) => `/back-catalogue/${data.page.fileSlug}/photos/`,
    // Where its YouTube thumbnails live: <video id>.jpg (scripts/fetch-video-thumbs.mjs).
    videoBase: (data) => `/back-catalogue/${data.page.fileSlug}/videos/`,
    videoCount: (data) =>
      [...(data.setlist ?? []), ...(data.extras ?? [])].filter((s) => s.video).length,
  },
};
