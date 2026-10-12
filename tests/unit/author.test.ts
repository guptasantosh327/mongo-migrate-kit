import { describe, expect, it } from 'vitest';
import { type GitConfigReader, detectAuthor, readGitConfig } from '../../src/utils/author.js';

/** A git reader that answers from a fixed map, ignoring cwd */
function gitWith(values: Record<string, string | undefined>): GitConfigReader {
  return (key) => values[key];
}

const noGit: GitConfigReader = () => undefined;

describe('detectAuthor', () => {
  it('should prefer the explicit --author value over everything else', () => {
    const author = detectAuthor({
      explicit: '  Flag Person ',
      configured: 'Config Person',
      cwd: '.',
      git: gitWith({ 'user.name': 'Git Person', 'user.email': 'git@example.com' }),
      osUser: () => 'osuser',
    });
    expect(author).toBe('Flag Person');
  });

  it('should use the configured author when no flag is given', () => {
    const author = detectAuthor({
      configured: ' Config Person ',
      cwd: '.',
      git: gitWith({ 'user.name': 'Git Person' }),
    });
    expect(author).toBe('Config Person');
  });

  it('should treat a blank flag or config value as unset and fall through to git', () => {
    const author = detectAuthor({
      explicit: '   ',
      configured: '',
      cwd: '.',
      git: gitWith({ 'user.name': 'Git Person', 'user.email': 'git@example.com' }),
    });
    expect(author).toBe('Git Person <git@example.com>');
  });

  it('should use the git name alone when no email is configured', () => {
    expect(detectAuthor({ cwd: '.', git: gitWith({ 'user.name': 'Git Person' }) })).toBe(
      'Git Person',
    );
  });

  it('should use the git email alone when no name is configured', () => {
    expect(detectAuthor({ cwd: '.', git: gitWith({ 'user.email': 'git@example.com' }) })).toBe(
      'git@example.com',
    );
  });

  it('should pass the cwd through to git so a repo-local identity applies', () => {
    const seen: string[] = [];
    detectAuthor({
      cwd: '/some/migrations',
      git: (key, cwd) => {
        seen.push(`${key}@${cwd}`);
        return undefined;
      },
      osUser: () => undefined,
    });
    expect(seen).toEqual(['user.name@/some/migrations', 'user.email@/some/migrations']);
  });

  it('should fall back to the OS username when git has no identity', () => {
    expect(detectAuthor({ cwd: '.', git: noGit, osUser: () => ' osuser ' })).toBe('osuser');
  });

  it('should return undefined when nothing is available', () => {
    expect(detectAuthor({ cwd: '.', git: noGit, osUser: () => undefined })).toBeUndefined();
    expect(detectAuthor({ cwd: '.', git: noGit, osUser: () => '  ' })).toBeUndefined();
  });

  it('should use the real OS username by default', () => {
    expect(typeof detectAuthor({ cwd: '.', git: noGit })).toBe('string');
  });
});

describe('readGitConfig', () => {
  it('should return undefined for a key that is not set', () => {
    expect(readGitConfig('mmk.surely-not-set-anywhere', process.cwd())).toBeUndefined();
  });

  it('should return undefined instead of throwing when the directory does not exist', () => {
    expect(readGitConfig('user.name', '/definitely/not/a/real/dir')).toBeUndefined();
  });
});
