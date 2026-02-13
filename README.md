# Repka Blog

A simple blog built with [Eleventy](https://www.11ty.dev/), deployed to GitHub Pages via GitHub Actions. Posts are written in Markdown.

## Prerequisites

You need **Node.js** (version 18 or later) installed on your machine. Node.js comes with **npm** (Node Package Manager), which is used to install dependencies and run scripts.

- **macOS**: `brew install node`
- **Windows**: Download the installer from [nodejs.org](https://nodejs.org/)
- **Linux**: Use your package manager, e.g. `sudo apt install nodejs npm`

Verify your installation by running:

```sh
node --version
npm --version
```

## Getting Started

1. **Clone the repository:**

   ```sh
   git clone https://github.com/repkam09/repka-blog.git
   cd repka-blog
   ```

2. **Install dependencies:**

   ```sh
   npm install
   ```

   This reads `package.json` and downloads everything the project needs into a `node_modules/` folder. You only need to do this once (or again if dependencies change).

3. **Start the local dev server:**

   ```sh
   npm run dev
   ```

   This starts a local server at `http://localhost:8080` with live reload. Any time you save a file, the browser will automatically refresh.

4. **Build the site (without a server):**

   ```sh
   npm run build
   ```

   This generates the full static site into the `_site/` folder. This is what gets deployed to GitHub Pages.

## Project Structure

```
repka-blog/
├── .github/workflows/deploy.yml   # GitHub Actions workflow for deployment
├── eleventy.config.js             # Eleventy configuration
├── package.json                   # Project dependencies and scripts
├── src/
│   ├── _data/
│   │   └── metadata.json          # Site-wide metadata (title, author, URL)
│   ├── _includes/
│   │   └── layouts/
│   │       ├── base.njk           # Base HTML layout (head, nav, footer)
│   │       └── post.njk           # Blog post layout
│   ├── css/
│   │   └── style.css              # Site styles
│   ├── index.njk                  # Homepage (lists all posts)
│   └── posts/
│       ├── posts.json             # Shared config for all posts
│       ├── hello-world/
│       │   └── index.md           # A blog post
│       └── second-post/
│           └── index.md           # Another blog post
└── _site/                         # Generated output (do not edit)
```

## Writing a New Post

1. Create a new folder inside `src/posts/` with a URL-friendly name:

   ```sh
   mkdir src/posts/my-new-post
   ```

2. Create an `index.md` file inside it:

   ```md
   ---
   title: My New Post
   date: 2026-02-15
   description: A short summary of the post.
   ---

   Write your post content here using Markdown.

   You can use **bold**, *italics*, [links](https://example.com),
   code blocks, lists, and anything else Markdown supports.
   ```

3. That's it. The post will automatically appear on the homepage and in the RSS feed.

### Frontmatter fields

The section between the `---` lines at the top of each post is called **frontmatter**. It defines metadata about the post:

| Field         | Required | Description                              |
|---------------|----------|------------------------------------------|
| `title`       | Yes      | The post title, shown as the heading     |
| `date`        | Yes      | Publication date in `YYYY-MM-DD` format  |
| `description` | No       | Short summary for SEO and the RSS feed   |

### Adding Images to a Post

Place image files directly in the post's folder, next to `index.md`:

```
src/posts/my-new-post/
├── index.md
├── photo.jpg
└── diagram.png
```

Then reference them in your Markdown with a relative path:

```md
![A photo](./photo.jpg)

![A diagram](./diagram.png)
```

The images will be copied to the output automatically.

## Customization

### Site Metadata

Edit `src/_data/metadata.json` to change the site title, author name, email, and URL.

### Styles

Edit `src/css/style.css`. This is plain CSS with no framework — you have full control.

### Layouts

The HTML structure is defined in Nunjucks templates inside `src/_includes/layouts/`:

- `base.njk` — the outer HTML shell (head, nav, footer) used by every page
- `post.njk` — wraps blog post content in an `<article>` tag

These are standard HTML files with `{{ variable }}` placeholders. Edit them to change the site's structure, add a logo, update navigation, etc.

### RSS Feed

The Atom feed is generated automatically at `/feed.xml` from the posts collection. Its metadata (title, author, URL) is configured in `eleventy.config.js` under the `feedPlugin` options.

## Deployment

The site is deployed automatically to GitHub Pages when you push to the `main` branch.

### One-time setup

1. Push this repository to GitHub under your account
2. Go to **Settings > Pages** in the repository
3. Set **Source** to **GitHub Actions**

After that, every push to `main` will trigger the workflow in `.github/workflows/deploy.yml`, which builds the site and deploys it to GitHub Pages.

The site will be available at `https://<username>.github.io/repka-blog/`.
