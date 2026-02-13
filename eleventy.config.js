import { feedPlugin } from "@11ty/eleventy-plugin-rss";

export default function (eleventyConfig) {
  eleventyConfig.addPassthroughCopy("src/css");
  eleventyConfig.addPassthroughCopy("src/posts/**/*.{jpg,png,gif,svg,webp}");
  eleventyConfig.addPassthroughCopy("src/CNAME");

  eleventyConfig.addFilter("readableDate", (dateObj) => {
    return new Date(dateObj).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  });

  eleventyConfig.addPlugin(feedPlugin, {
    type: "atom",
    outputPath: "/feed.xml",
    collection: {
      name: "posts",
      limit: 20,
    },
    metadata: {
      language: "en",
      title: "Mark Repka",
      subtitle: "A sample blog by Mark Repka",
      base: "https://blog.repkam09.com/",
      author: {
        name: "Mark Repka",
        email: "mark+blog@repkam09.com",
      },
    },
  });

  eleventyConfig.addCollection("posts", function (collectionApi) {
    return collectionApi.getFilteredByGlob("src/posts/**/*.md").reverse();
  });

  return {
    dir: {
      input: "src",
      output: "_site",
      includes: "_includes",
      data: "_data",
    },
  };
}
