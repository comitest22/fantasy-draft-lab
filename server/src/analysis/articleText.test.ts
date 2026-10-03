import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractParagraphs,
  extractTitle,
  isPublicHttpUrl,
  summarizeExcerpt,
  decodeEntities,
  isPaywallHost,
  isReadableArticle,
  looksLikePaywall,
} from './articleText';

describe('isPublicHttpUrl', () => {
  it('allows public https hosts', () => {
    assert.equal(isPublicHttpUrl('https://nypost.com/story')?.hostname, 'nypost.com');
  });

  it('blocks localhost and private ranges', () => {
    assert.equal(isPublicHttpUrl('http://localhost/x'), null);
    assert.equal(isPublicHttpUrl('http://127.0.0.1/x'), null);
    assert.equal(isPublicHttpUrl('http://192.168.1.9/x'), null);
    assert.equal(isPublicHttpUrl('http://10.0.0.4/x'), null);
    assert.equal(isPublicHttpUrl('file:///etc/passwd'), null);
  });
});

describe('extractParagraphs', () => {
  it('pulls article paragraphs and skips chrome', () => {
    const html = `
      <html><head><title>Test</title>
      <meta property="og:title" content="Packers RB news">
      </head><body>
      <p>Cookie policy</p>
      <p>The fantasy football draft season moves at lightning speed. Wasn’t it just the other day?</p>
      <p>MarShawn Lloyd has skyrocketed up boards after the latest Jacobs update from Green Bay.</p>
      </body></html>
    `;
    const paras = extractParagraphs(html);
    assert.equal(paras.length, 2);
    assert.match(paras[0], /lightning speed/);
    assert.equal(extractTitle(html), 'Packers RB news');
  });

  it('drops duplicate paragraphs from mirrored DOM copies', () => {
    const lead =
      'Fantasy football owners are forever searching for running backs they can start week to week. It is the most volatile position in the league.';
    const next =
      'White is the second back in the Commanders committee, but it has been very close this season as far as snaps go.';
    const html = `
      <html><body>
      <div class="mobile"><p>${lead}</p><p>${next}</p></div>
      <div class="desktop"><p>${lead}</p><p>${next}</p></div>
      </body></html>
    `;
    const paras = extractParagraphs(html);
    assert.equal(paras.length, 2);
    assert.equal(paras[0], lead);
    assert.equal(paras[1], next);
  });

  it('decodes html entities', () => {
    assert.equal(decodeEntities('It&#x27;s Allen&#39;s year'), "It's Allen's year");
  });
});

describe('summarizeExcerpt', () => {
  it('keeps short articles whole', () => {
    const { excerpt, truncated } = summarizeExcerpt([
      'The Bills come into the season as one of the AFC strongest teams with Josh Allen.',
    ]);
    assert.equal(truncated, false);
    assert.match(excerpt, /Josh Allen/);
  });

  it('truncates long articles to the lead', () => {
    const long = Array.from({ length: 40 }, (_, i) =>
      `Paragraph ${i + 1} adds more detail about the Bills offense and how Josh Allen can push for another MVP.`
    );
    const { excerpt, truncated } = summarizeExcerpt(long, 50);
    assert.equal(truncated, true);
    assert.match(excerpt, /Paragraph 1/);
    assert.doesNotMatch(excerpt, /Paragraph 40/);
  });
});

describe('isReadableArticle', () => {
  it('rejects paywalled teasers and errors', () => {
    const teaser = [
      'In the last of a six-part draft preview series, Fantasy Insanity recaps changes in the player value and draft price.',
      'The fantasy football draft season moves at lightning speed. Wasn’t it just the other day that Ricky Pearsall was a potential late-round sleeper pick?',
    ].join('\n\n');
    assert.equal(isReadableArticle({ excerpt: teaser }), false);
    assert.equal(isReadableArticle({ excerpt: 'Plenty of words here but it errored.', error: 'Paywalled publisher.' }), false);
  });

  it('keeps a full free article lead', () => {
    const paras = Array.from({ length: 5 }, (_, i) =>
      `Paragraph ${i + 1} covers how MarShawn Lloyd takes over in Green Bay with Josh Jacobs on the Commissioner's Exempt List and what that means for fantasy managers this week.`
    );
    assert.equal(isReadableArticle({ excerpt: paras.join('\n\n') }), true);
  });
});

describe('paywall detection', () => {
  it('spots known paywall hosts and interstitial copy', () => {
    assert.equal(isPaywallHost('https://nypost.com/2026/09/05/sports/story/'), true);
    assert.equal(isPaywallHost('https://sports.yahoo.com/articles/x.html'), false);
    assert.equal(looksLikePaywall('<div>Subscribe to continue reading this article</div>'), true);
    assert.equal(looksLikePaywall('<p>Josh Allen led the Bills last season.</p>'), false);
  });
});
