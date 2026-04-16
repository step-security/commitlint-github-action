import { existsSync, readFileSync } from 'fs';
import { setOutput, getInput, setFailed, info, error } from '@actions/core';
import axios from 'axios';
import { resolve } from 'path';
import { context, getOctokit } from '@actions/github';
import lint from '@commitlint/lint';
import { format } from '@commitlint/format';
import load from '@commitlint/load';

const resultsOutputId = 'results';
const mapMessageValidation = item => item.message;
const mapResultOutput = ({
  hash,
  lintResult: {
    valid,
    errors,
    warnings,
    input
  }
}) => ({
  hash,
  message: input,
  valid,
  errors: errors.map(mapMessageValidation),
  warnings: warnings.map(mapMessageValidation)
});
const generateOutputs = lintedCommits => {
  const resultsOutput = lintedCommits.map(mapResultOutput);
  setOutput(resultsOutputId, resultsOutput);
};

const mergeGroupEvent = 'merge_group';
const pullRequestEvent = 'pull_request';
const pullRequestTargetEvent = 'pull_request_target';
const pullRequestEvents = [pullRequestEvent, pullRequestTargetEvent];
const {
  GITHUB_EVENT_NAME
} = process.env;
const FIRST_COMMIT_SHA = '0000000000000000000000000000000000000000';
const configPath = resolve(process.env.GITHUB_WORKSPACE, getInput('configFile'));
const getCommitDepth = () => {
  const commitDepthString = getInput('commitDepth');
  if (!commitDepthString?.trim()) return null;
  const commitDepth = parseInt(commitDepthString, 10);
  return Number.isNaN(commitDepth) ? null : Math.max(commitDepth, 0);
};
const getPushEventCommits = async () => {
  const octokit = getOctokit(getInput('token'));
  const {
    owner,
    repo
  } = context.issue;
  const {
    before,
    after
  } = context.payload;
  if (before === FIRST_COMMIT_SHA) {
    return context.payload.commits.map(commit => ({
      message: commit.message,
      hash: commit.id
    }));
  }
  const {
    data: comparison
  } = await octokit.rest.repos.compareCommits({
    owner,
    repo,
    head: after,
    base: before,
    per_page: 100
  });
  return comparison.commits.map(commit => ({
    message: commit.commit.message,
    hash: commit.sha
  }));
};
const getPullRequestEventCommits = async () => {
  const octokit = getOctokit(getInput('token'));
  const {
    owner,
    repo,
    number
  } = context.issue;
  const {
    data: commits
  } = await octokit.rest.pulls.listCommits({
    owner,
    repo,
    pull_number: number,
    per_page: 100
  });
  return commits.map(commit => ({
    message: commit.commit.message,
    hash: commit.sha
  }));
};
const getMergeGroupEventCommits = async () => {
  const {
    merge_group: mergeGroup
  } = context.payload;
  return [{
    message: mergeGroup.head_commit.message,
    hash: mergeGroup.head_sha
  }];
};
const getEventCommits = async () => {
  if (GITHUB_EVENT_NAME === mergeGroupEvent) {
    return getMergeGroupEventCommits();
  }
  if (pullRequestEvents.includes(GITHUB_EVENT_NAME)) {
    return getPullRequestEventCommits();
  }
  if (context.payload.commits) {
    return getPushEventCommits();
  }
  return [];
};
function getOptsFromConfig(config) {
  return {
    parserOpts: config.parserPreset != null && config.parserPreset.parserOpts != null ? config.parserPreset.parserOpts : {},
    plugins: config.plugins != null ? config.plugins : {},
    ignores: config.ignores != null ? config.ignores : [],
    defaultIgnores: config.defaultIgnores != null ? config.defaultIgnores : true
  };
}
const formatErrors = (lintedCommits, {
  config
}) => format({
  results: lintedCommits.map(commit => commit.lintResult)
}, {
  color: true,
  helpUrl: config.helpUrl || getInput('helpURL')
});
const hasOnlyWarnings = lintedCommits => lintedCommits.length && lintedCommits.every(({
  lintResult
}) => lintResult.valid) && lintedCommits.some(({
  lintResult
}) => lintResult.warnings.length);
const setFailedAction = formattedResults => {
  setFailed(`You have commit messages with errors\n\n${formattedResults}`);
};
const handleOnlyWarnings = formattedResults => {
  if (getInput('failOnWarnings') === 'true') {
    setFailedAction(formattedResults);
  } else {
    console.log(`You have commit messages with warnings\n\n${formattedResults}`);
  }
};
const showLintResults = async eventCommits => {
  let commits = eventCommits;
  const commitDepth = getCommitDepth();
  if (commitDepth) {
    commits = commits?.slice(0, commitDepth);
  }
  if (configPath?.endsWith('.js')) {
    throw new Error('.js extension is not allowed for the `configFile`, please use .mjs instead');
  }
  const config = existsSync(configPath) ? await load({}, {
    file: configPath
  }) : await load({
    extends: ['@commitlint/config-conventional']
  });
  const opts = getOptsFromConfig(config);
  const lintedCommits = await Promise.all(commits.map(async commit => ({
    lintResult: await lint(commit.message, config.rules, opts),
    hash: commit.hash
  })));
  const formattedResults = formatErrors(lintedCommits, {
    config
  });
  generateOutputs(lintedCommits);
  if (hasOnlyWarnings(lintedCommits)) {
    handleOnlyWarnings(formattedResults);
  } else if (formattedResults && getInput('failOnErrors') === 'false') {
    // https://github.com/actions/toolkit/tree/master/packages/core#exit-codes
    // this would be a good place to implement the setNeutral() when it's eventually implimented.
    // for now it can pass with a check mark.
    console.log(formattedResults);
    console.log('Fail on Errors is set to false: Passing despite errors ✅');
  } else if (formattedResults) {
    setFailedAction(formattedResults);
  } else {
    console.log('Lint free! 🎉');
  }
};
const exitWithMessage = message => error => {
  setFailedAction(`${message}\n${error.message}\n${error.stack}`);
};
const commitLinterAction = () => getEventCommits().catch(exitWithMessage("error trying to get list of pull request's commits")).then(showLintResults).catch(exitWithMessage('error running commitlint'));

async function validateSubscription() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  let repoPrivate;
  if (eventPath && existsSync(eventPath)) {
    const eventData = JSON.parse(readFileSync(eventPath, 'utf8'));
    repoPrivate = eventData?.repository?.private;
  }
  const upstream = 'wagoid/commitlint-github-action';
  const actionRepo = process.env.GITHUB_ACTION_REPOSITORY;
  const docsUrl = 'https://docs.stepsecurity.io/actions/stepsecurity-maintained-actions';
  info('');
  info('\u001b[1;36mStepSecurity Maintained Action\u001b[0m');
  info(`Secure drop-in replacement for ${upstream}`);
  if (repoPrivate === false) info('\u001b[32m\u2713 Free for public repositories\u001b[0m');
  info(`\u001b[36mLearn more:\u001b[0m ${docsUrl}`);
  info('');
  if (repoPrivate === false) return;
  const serverUrl = process.env.GITHUB_SERVER_URL || 'https://github.com';
  const body = {
    action: actionRepo || ''
  };
  if (serverUrl !== 'https://github.com') body.ghes_server = serverUrl;
  try {
    await axios.post(`https://agent.api.stepsecurity.io/v1/github/${process.env.GITHUB_REPOSITORY}/actions/maintained-actions-subscription`, body, {
      timeout: 3000
    });
  } catch (err) {
    if (axios.isAxiosError(err) && err.response?.status === 403) {
      error('\u001b[1;31mThis action requires a StepSecurity subscription for private repositories.\u001b[0m');
      error(`\u001b[31mLearn how to enable a subscription: ${docsUrl}\u001b[0m`);
      process.exit(1);
    }
    info('Timeout or API not reachable. Continuing to next step.');
  }
}
async function main() {
  await validateSubscription();
  await commitLinterAction();
}
main();
