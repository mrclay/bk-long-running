require('dotenv').config();

const fetch = require('node-fetch');
const fs = require('fs');
const qs = require('querystring');
const { createObjectCsvWriter } = require('csv-writer');

const ROOT = 'https://api.buildkite.com/v2';

async function get(url, query = null) {
  const fullUrl = url + (query ? `?${qs.stringify(query)}` : '');
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
    pipelines => {
      for (const pipeline of pipelines) {
        const { web_url, steps, provider, name } = pipeline;
        const repo = 'https://github.com/' + provider.settings.repository;
        if (!steps.length) {
          continue;
        }

        const uses_yaml =
          steps[0].command === 'buildkite-agent pipeline upload';
        if (!uses_yaml) {
          allPipelines.push({
            name: name.trim(),
            web_url,
            repo,
          });
        }
      }
    },
  );

  let csvWriter = createObjectCsvWriter({
    path: `${__dirname}/output/repos.csv`,
    header: [
      {id: 'name', title: 'Pipeline Name'},
      {id: 'web_url', title: 'URL'},
      {id: 'repo', title: 'Repo URL'},
    ]
  });
  await csvWriter.writeRecords(allPipelines);

  await pagedGet(
    `${ROOT}/organizations/${process.env.BK_ORG}/builds`,
    { state: 'running' },
    builds => {
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
    },
  );

  csvWriter = createObjectCsvWriter({
    path: `${__dirname}/output/long-running.csv`,
    header: [
      {id: 'build_url', title: 'Build URL'},
      {id: 'email', title: 'Creator Email'},
      {id: 'name', title: 'Creator Name'},
    ]
  });
  await csvWriter.writeRecords(longBuilds);
}

go().catch(e => console.error(e));
