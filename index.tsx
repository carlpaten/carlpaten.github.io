import React from "react";
import ReactDOM from "react-dom/server.js";
import { marked } from "marked";
import { promises as fs, constants as fsConstants } from "fs";
import path from "path";
import { ensureDirectoryExists, exec, usingRemoteGitBranch } from "./lib.js";
import { DateTime } from "luxon";
import yaml from "js-yaml";
import { z } from "zod";
import CleanCSS from "clean-css";

const frontMatterSchema = z.object({
  title: z.string(),
  description: z.string(),
  date: z.string().transform((s) => DateTime.fromISO(s)),
});

type FrontMatter = z.infer<typeof frontMatterSchema>;

type Article = {
  frontMatter: FrontMatter,
  body: string;
  slug: string;
};

const Head: React.FC<{ styles: string }> = (props) => {
  return <head><style dangerouslySetInnerHTML={{ __html: props.styles }}></style></head>;
}

const Header: React.FC = () => {
  return <header><h1>Technology Review</h1></header>;
}

const Article: React.FC<{ article: Article }> = (props) => {
  const html = marked.parse(props.article.body);
  return <body>
    <Header />
    <main><div dangerouslySetInnerHTML={{ __html: html }} /></main>
  </body>;
};

const TableOfContents: React.FC<{ articles: Article[] }> = (props) => {
  return (
    <body>
      <Header />
      <main>
        <div id="about-the-author">
          <div id="profile-pic-container">
            <img src="./assets/profile-pic.png" decoding="async" style={{ opacity: 1 }} />
          </div>
          <div>
            Written by <strong>Carl Patenaude-Poulin</strong>.
            Based in Montreal, he is fascinated by software engineering, yoga, and the outdoors.
          </div>
          {/* TODO mailto */}
        </div>


        <div id="table-of-contents">
          <ul>
            {props.articles
              .sort((a, b) => a.frontMatter.date.toMillis() - b.frontMatter.date.toMillis())
              .map((article) => (
                <li key={article.slug}>
                  <header>
                    <a href={`./${article.slug}.html`}><h2>{article.frontMatter.title}</h2></a>
                    <div className="date">{article.frontMatter.date.toLocaleString(DateTime.DATE_FULL)}</div>
                  </header>
                  <section>
                    {article.frontMatter.description}
                  </section>
                </li>
              ))}
          </ul>
        </div>
      </main>
    </body>
  );
};

async function renderComponentToFile(
  outPath: string,
  header: React.ReactElement,
  body: React.ReactElement,
): Promise<void> {
  const fileHandle = await fs.open(outPath, fsConstants.O_WRONLY | fsConstants.O_CREAT);
  try {
    await fileHandle.truncate();
    await fileHandle.write("<!doctype html>");
    await fileHandle.write(ReactDOM.renderToStaticMarkup(header));
    await fileHandle.write(ReactDOM.renderToStaticMarkup(body));
  } finally {
    await fileHandle.close();
  }
}

async function parseArticles(dir: string): Promise<{ fileName: string; body: React.ReactElement }[]> {
  const articleFileNames = await fs.readdir(dir);
  const articles = await Promise.all(
    articleFileNames.map(async (fileName): Promise<Article> => {
      const filePath = path.join(dir, fileName);
      const content = await fs.readFile(filePath, { encoding: "utf8" });
      const frontMatterMatch = /^\s*---\s*\n((.|\n)+?)\n\s*---\s*\n((.|\n)+)$/.exec(content);
      if (!frontMatterMatch) throw new Error(`Article is malformed: ${filePath}`)
      const frontMatter = frontMatterSchema.parse(yaml.load(frontMatterMatch[1]));
      const body = frontMatterMatch[3];
      return {
        frontMatter,
        body,
        slug: fileName.replace(/^([a-z0-9-]+).md$/, "$1"),
      };
    })
  );

  return [
    {
      fileName: "index.html",
      body: <TableOfContents articles={articles} />,
    },
    ...articles.map((article) => ({
      fileName: `${article.slug}.html`,
      body: <Article article={article} />,
    })),
  ];
}

async function getStaticAssets(dir: string): Promise<{ fileName: string, content: Buffer }[]> {
  const assetFileNames = await fs.readdir(dir);
  return await Promise.all(
    assetFileNames.map(async fileName => {
      const filePath = path.join(dir, fileName);
      return { fileName, content: await fs.readFile(filePath) };
    })
  );
}

async function getStyles() {
  const styles = await fs.readFile("styles.css", { encoding: "utf8" });
  return new CleanCSS().minify(styles).styles;
}

export async function build() {
  const articles = await parseArticles("content");
  const styles = await getStyles();
  const staticAssets = await getStaticAssets("assets");

  const outDir = "dist";
  await ensureDirectoryExists(outDir);

  const assetsDir = path.join(outDir, "assets");
  await ensureDirectoryExists(assetsDir);

  await Promise.all([
    ...articles.map(({ fileName, body }) =>
      renderComponentToFile(path.join(outDir, fileName), <Head styles={styles} />, body)
    ),
    ...staticAssets.map(({ fileName, content }) =>
      fs.writeFile(path.join(outDir, "assets", fileName), content)
    ),
  ]);
}

export async function deploy() {
  const articles = await parseArticles("content");
  const styles = await getStyles();
  const staticAssets = await getStaticAssets("assets");

  const releaseBranch = "dist";
  const assetsDir = "assets";
  await usingRemoteGitBranch("origin", releaseBranch, async () => {
    await ensureDirectoryExists(assetsDir)
    await Promise.all([
      ...articles.map(({ fileName, body }) =>
        renderComponentToFile(fileName, <Head styles={styles} />, body)
      ),
      ...staticAssets.map(({ fileName, content }) =>
        fs.writeFile(path.join(assetsDir, fileName), content)
      )
    ]);

    await push(releaseBranch, "deploy");
  });

}

async function push(branch: string, message: string) {
  await exec("git add *.html");
  await exec(`git commit --all --allow-empty --message='${message}'`);
  await exec(`git push --set-upstream origin ${branch}`);
}