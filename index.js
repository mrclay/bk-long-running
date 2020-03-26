require('dotenv').config();

const fetch = require('node-fetch');
const fs = require('fs');
const qs = require('querystring');

const ROOT = 'https://api.buildkite.com/v2';

async function get(url, get = null) {
  const fullUrl = url + (get ? `?${qs.stringify(get)}` : '');
  console.info(`Fetching: ${fullUrl}`);
  const res = await fetch(fullUrl, {
    headers: {'Authorization': `Bearer ${process.env.BK_TOKEN}`},
  });
  return res.json();
}

async function go() {
  const allPipelines = [];
  const longBuilds = [];

  let page = 1;
  while (true) {
    const pipelines = await get(`${ROOT}/organizations/${process.env.BK_ORG}/pipelines`, {
      per_page: 100,
      page,
    });
    page++;

    if (!Array.isArray(pipelines) || !pipelines.length) {
      break;
    }

    for (const pipeline of pipelines) {
      const { slug, web_url, steps, provider, name } = pipeline;
      const repo = 'https://github.com/' + provider.settings.repository;
      if (!steps.length) {
        continue;
      }

      const uses_yaml = steps[0].command === 'buildkite-agent pipeline upload';
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

  page = 1;
  while (true) {
    const builds = await get(`${ROOT}/organizations/${process.env.BK_ORG}/builds`, {
      per_page: 100,
      page,
      state: 'running',
    });
    page++;

    if (!Array.isArray(builds) || !builds.length) {
      break;
    }

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

  let md = '';

  md += `\n## long-running builds\n\n`;
  longBuilds.forEach(b => {
    md += `* ${b.build_url} ([${b.name}](mailto:${b.email}))\n`;
  });

  md += '\n## unconverted repos\n\n';
  allPipelines.forEach(p => {
    md += `* **${p.name}** [pipeline](${p.web_url}) | [repo](${p.repo})\n`;
  });

  fs.writeFileSync(`${__dirname}/${process.env.OUT}`, md);
}

go()
  .catch(e => console.error(e));
