require("dotenv").config();

const fetch = require("node-fetch");
const fs = require("fs");
const qs = require("querystring");

const ROOT = "https://api.buildkite.com/v2";

async function get(url, query = null) {
  const fullUrl = url + (query ? `?${qs.stringify(query)}` : "");
  console.info(`Fetching: ${fullUrl}`);
  const res = await fetch(fullUrl, {
    headers: { Authorization: `Bearer ${process.env.BK_TOKEN}` },
  });
  return res.json();
}

async function pagedGet(url, query = {}, func) {
  let page = 1;
  while (true) {
    const data = await get(url, {
      ...query,
      per_page: query.per_page || 100,
      page,
    });

    if (Array.isArray(data) && data.length) {
      await func(data, page);
      page++;
    } else {
      break;
    }
  }
}

async function go() {
  const allPipelines = [];
  const longBuilds = [];

  await pagedGet(
    `${ROOT}/organizations/${process.env.BK_ORG}/pipelines`,
    {},
    (pipelines) => {
      for (const pipeline of pipelines) {
        const { slug, web_url, steps, provider, name } = pipeline;
        const repo = "https://github.com/" + provider.settings.repository;
        if (!steps.length) {
          continue;
        }

        const uses_yaml =
          steps[0].command === "buildkite-agent pipeline upload";
        if (!uses_yaml) {
          allPipelines.push({
            slug,
            name: name.trim(),
            web_url,
            repo,
          });
        }
      }
    }
  );

  await pagedGet(
    `${ROOT}/organizations/${process.env.BK_ORG}/builds`,
    { state: "running" },
    (builds) => {
      for (const build of builds) {
        const { web_url: build_url, creator, started_at } = build;
        const elapsed = new Date().getTime() - new Date(started_at).getTime();

        if (elapsed > process.env.MINUTES * 60e3) {
          longBuilds.push({
            build_url,
            email: creator.email,
            name: creator.name,
          });
        }
      }
    }
  );

  let md = "";

  md += `\n## long-running builds\n\n`;
  longBuilds.forEach((b) => {
    md += `* ${b.build_url} ([${b.name}](mailto:${b.email}))\n`;
  });

  md += "\n## unconverted repos\n\n";
  allPipelines.forEach((p) => {
    md += `* **[${p.name}](${p.repo})** - [pipeline](${p.web_url})\n`;
  });

  fs.writeFileSync(`${__dirname}/${process.env.OUT}`, md);
}

go().catch((e) => console.error(e));
