function blank(character) {
  return character === '\n' || character === '\r' ? character : ' ';
}

/**
 * Remove JavaScript/TypeScript comments and string contents while preserving
 * source length. Executable `${...}` template expressions remain visible so
 * static call checks can distinguish them from inert template text.
 */
export function stripJsCommentsAndStrings(source) {
  const input = String(source ?? '');
  const output = [];
  let state = 'code';
  let stringDelimiter = '';
  const templateExpressionDepths = [];

  for (let index = 0; index < input.length; index++) {
    const character = input[index];
    const next = input[index + 1];

    if (state === 'code') {
      if (character === '/' && next === '/') {
        output.push(' ', ' ');
        index++;
        state = 'line-comment';
      } else if (character === '/' && next === '*') {
        output.push(' ', ' ');
        index++;
        state = 'block-comment';
      } else if (character === "'" || character === '"') {
        output.push(' ');
        stringDelimiter = character;
        state = 'string';
      } else if (character === '`') {
        output.push(' ');
        state = 'template';
      } else if (templateExpressionDepths.length > 0 && character === '{') {
        templateExpressionDepths[templateExpressionDepths.length - 1]++;
        output.push(character);
      } else if (templateExpressionDepths.length > 0 && character === '}') {
        const expressionIndex = templateExpressionDepths.length - 1;
        templateExpressionDepths[expressionIndex]--;
        output.push(character);
        if (templateExpressionDepths[expressionIndex] === 0) {
          templateExpressionDepths.pop();
          state = 'template';
        }
      } else {
        output.push(character);
      }
      continue;
    }

    if (state === 'line-comment') {
      output.push(blank(character));
      if (character === '\n' || character === '\r') state = 'code';
      continue;
    }

    if (state === 'block-comment') {
      if (character === '*' && next === '/') {
        output.push(' ', ' ');
        index++;
        state = 'code';
      } else {
        output.push(blank(character));
      }
      continue;
    }

    if (state === 'template') {
      if (character === '\\') {
        output.push(' ');
        if (index + 1 < input.length) {
          output.push(blank(next));
          index++;
        }
      } else if (character === '`') {
        output.push(' ');
        state = 'code';
      } else if (character === '$' && next === '{') {
        output.push(' ', '{');
        index++;
        templateExpressionDepths.push(1);
        state = 'code';
      } else {
        output.push(blank(character));
      }
      continue;
    }

    if (character === '\\') {
      output.push(' ');
      if (index + 1 < input.length) {
        output.push(blank(next));
        index++;
      }
    } else {
      output.push(blank(character));
      if (character === stringDelimiter) {
        stringDelimiter = '';
        state = 'code';
      }
    }
  }

  return output.join('');
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

export function findExecutableCallIndices(source, callName) {
  const sanitized = stripJsCommentsAndStrings(source);
  const callPattern = new RegExp(`\\b${escapeRegExp(callName)}\\s*\\(`, 'gu');
  const indices = [];

  for (const match of sanitized.matchAll(callPattern)) {
    const index = match.index ?? -1;
    if (index < 0) continue;
    const prefix = sanitized.slice(Math.max(0, index - 80), index);
    if (/\bfunction\s*$/u.test(prefix)) continue;
    indices.push(index);
  }

  return indices;
}

export function hasExecutableCall(source, callName) {
  return findExecutableCallIndices(source, callName).length > 0;
}

function findPatternIndices(source, pattern) {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  const globalPattern = new RegExp(pattern.source, flags);
  const indices = [];
  for (const match of String(source).matchAll(globalPattern)) {
    if (match.index !== undefined) indices.push(match.index);
  }
  return indices;
}

export function guardPrecedesEverySink(source, guardCallName, sinkPattern) {
  const sanitized = stripJsCommentsAndStrings(source);
  const guardIndices = findExecutableCallIndices(source, guardCallName);
  const sinkIndices = findPatternIndices(sanitized, sinkPattern);
  return sinkIndices.length > 0
    && sinkIndices.every((sinkIndex) => guardIndices.some((guardIndex) => guardIndex < sinkIndex));
}

/** Parse top-level workflow jobs and require an exact job-level false guard. */
export function inspectArchivedWorkflowJobs(source) {
  const lines = String(source ?? '').split(/\r?\n/u);
  const jobs = [];
  let inJobs = false;
  let currentJob = null;

  const flush = () => {
    if (currentJob) jobs.push(currentJob);
    currentJob = null;
  };

  for (const line of lines) {
    if (!inJobs) {
      if (/^(?:jobs|"jobs"|'jobs'):\s*(?:#.*)?$/u.test(line)) inJobs = true;
      continue;
    }

    if (/^[^\s#][^:]*:/u.test(line)) {
      flush();
      break;
    }

    const jobMatch = line.match(
      /^ {2}(?:([A-Za-z0-9_-]+)|"([A-Za-z0-9_-]+)"|'([A-Za-z0-9_-]+)'):(?:\s.*)?$/u,
    );
    if (jobMatch) {
      flush();
      currentJob = { name: jobMatch[1] ?? jobMatch[2] ?? jobMatch[3], hardDisabled: false };
      continue;
    }

    if (
      currentJob
      && /^ {4}(?:if|"if"|'if'):\s*\$\{\{\s*false\s*\}\}\s*(?:#.*)?$/u.test(line)
    ) {
      currentJob.hardDisabled = true;
    }
  }

  flush();
  return {
    jobNames: jobs.map((job) => job.name),
    jobsWithoutHardDisable: jobs.filter((job) => !job.hardDisabled).map((job) => job.name),
  };
}

/** Return executable shell lines contained in YAML run blocks. */
export function parseWorkflowRunCommands(source) {
  const lines = String(source ?? '').split(/\r?\n/u);
  const commands = [];
  let runIndent = null;
  let blockStartLine = null;

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const trimmed = line.trim();
    const indent = line.match(/^ */u)?.[0].length ?? 0;

    if (runIndent !== null) {
      if (!trimmed || indent > runIndent) {
        if (trimmed && !trimmed.startsWith('#')) {
          commands.push({ lineNumber: index + 1, blockStartLine, text: trimmed });
        }
        continue;
      }
      runIndent = null;
      blockStartLine = null;
    }

    const runBlockMatch = line.match(/^( *)(?:-\s+)?run:\s*\|[-+]?\s*(?:#.*)?$/u);
    if (runBlockMatch) {
      runIndent = runBlockMatch[1].length;
      blockStartLine = index + 1;
      continue;
    }

    const inlineRunMatch = line.match(/^( *)(?:-\s+)?run:\s+(.+)$/u);
    if (inlineRunMatch && !inlineRunMatch[2].trim().startsWith('#')) {
      commands.push({
        lineNumber: index + 1,
        blockStartLine: index + 1,
        text: inlineRunMatch[2].trim(),
      });
    }
  }

  return commands;
}

/** Commands, not comments or quoted prose, at the beginning of a shell file. */
export function shellExecutableLines(source) {
  return String(source ?? '')
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
}
