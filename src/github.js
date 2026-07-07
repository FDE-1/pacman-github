"use strict";

/**
 * @fileoverview GitHub contribution data access. Fetches the contribution
 * calendar through the GraphQL API with timeouts and exponential-backoff
 * retries, plus a deterministic mock generator for offline development and
 * testing.
 */

const { GRID } = require("./config");

const GRAPHQL_ENDPOINT = "https://api.github.com/graphql";
const CONTRIBUTIONS_QUERY = `
  query($login: String!) {
    user(login: $login) {
      contributionsCollection {
        contributionCalendar {
          weeks { contributionDays { date contributionCount } }
        }
      }
    }
  }`;

/** Error thrown for non-retryable API failures (bad token, unknown user…). */
class GitHubApiError extends Error {
  /**
   * @param {string} message
   * @param {{status?: number, cause?: unknown}} [details]
   */
  constructor(message, { status, cause } = {}) {
    super(message);
    this.name = "GitHubApiError";
    this.status = status;
    this.cause = cause;
  }
}

/** Sleep helper. */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch a user's contribution calendar as a column-major grid.
 *
 * @param {string} username GitHub login.
 * @param {string} token Token with `read:user` scope (Actions' GITHUB_TOKEN works).
 * @param {{fetchImpl?: typeof fetch, retries?: number, timeoutMs?: number}} [opts]
 * @returns {Promise<Array<Array<?number>>>} grid[week][weekday] = count or
 *   null for days outside the calendar window.
 * @throws {GitHubApiError} On non-retryable errors or after exhausting retries.
 */
async function fetchContributionGrid(
  username,
  token,
  { fetchImpl = fetch, retries = 3, timeoutMs = 15000 } = {}
) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await delay(500 * 2 ** (attempt - 1));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(GRAPHQL_ENDPOINT, {
        method: "POST",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "User-Agent": "pacman-eats-everything",
        },
        body: JSON.stringify({ query: CONTRIBUTIONS_QUERY, variables: { login: username } }),
      });

      if (res.status === 401 || res.status === 403) {
        throw new GitHubApiError(`GitHub API authentication failed (HTTP ${res.status})`, {
          status: res.status,
        });
      }
      if (!res.ok) {
        // 5xx and 429 are worth retrying.
        lastError = new GitHubApiError(`GitHub API HTTP ${res.status}`, { status: res.status });
        continue;
      }

      const json = await res.json();
      if (json.errors) {
        throw new GitHubApiError(`GraphQL errors: ${JSON.stringify(json.errors)}`);
      }
      const weeks = json?.data?.user?.contributionsCollection?.contributionCalendar?.weeks;
      if (!Array.isArray(weeks)) {
        throw new GitHubApiError(`Unexpected API response shape for user "${username}"`);
      }
      return weeksToGrid(weeks);
    } catch (err) {
      if (err instanceof GitHubApiError && err.status !== undefined && err.status < 500) {
        throw err; // non-retryable
      }
      if (err instanceof GitHubApiError && err.status === undefined && err.message.startsWith("G")) {
        throw err; // GraphQL/shape errors are non-retryable
      }
      lastError = err; // network error / timeout: retry
    } finally {
      clearTimeout(timer);
    }
  }
  throw new GitHubApiError(`GitHub API request failed after ${retries + 1} attempts`, {
    cause: lastError,
  });
}

/**
 * Convert the GraphQL `weeks` payload into a column-major grid.
 * @param {Array<{contributionDays: Array<{date: string, contributionCount: number}>}>} weeks
 * @returns {Array<Array<?number>>}
 */
function weeksToGrid(weeks) {
  return weeks.map((week) => {
    const days = new Array(GRID.ROWS).fill(null);
    for (const day of week.contributionDays) {
      const weekday = new Date(day.date + "T00:00:00Z").getUTCDay();
      days[weekday] = day.contributionCount;
    }
    return days;
  });
}

/**
 * Deterministic mock grid for offline development and tests.
 *
 * @param {() => number} rand Seeded PRNG.
 * @param {{weeks?: number, emptyProbability?: number}} [opts]
 * @returns {Array<Array<?number>>}
 */
function generateMockGrid(rand, { weeks = 53, emptyProbability = 0.42 } = {}) {
  const grid = [];
  for (let w = 0; w < weeks; w++) {
    const days = [];
    for (let d = 0; d < GRID.ROWS; d++) {
      const r = rand();
      days.push(r < emptyProbability ? 0 : Math.ceil(r * 14));
    }
    grid.push(days);
  }
  return grid;
}

module.exports = { fetchContributionGrid, generateMockGrid, weeksToGrid, GitHubApiError };
