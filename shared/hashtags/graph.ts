/**
 * Built-in related-terms graph for the offline hashtag generator.
 * Terms live in themes; two terms are neighbours when they share a theme. Bridge terms that appear
 * in several themes ("light", "golden", "forever", ...) connect the themes to each other.
 * (Terms are whitespace-separated strings so Prettier keeps the lists readable and compact.)
 */

import { tagKey } from './normalise.js';

const words = (list: string): readonly string[] => list.trim().split(/\s+/);

export const THEMES: Readonly<Record<string, readonly string[]>> = {
  love: words(`love devotion heart romance tenderness adoration longing beloved affection embrace
    cherish soulmates forever together passion faithful warmth kindness gratitude promise whisper
    dearest devoted sweetheart adore lovers`),
  eternity: words(`eternal eternity forever timeless infinity endless everlasting always ageless
    immortal evermore moment hourglass memory past future ephemeral fleeting twilight eternalLove
    neverEnding timelessBeauty cosmos stardust heartbeat infinite forevermore`),
  color: words(`colors color light palette hue shade tint pigment spectrum rainbow vivid pastel
    gradient swatch chroma saturation amber golden crimson azure violet emerald indigo coral
    colorStory colorPalette luminous glow bright mauve`),
  sky: words(`sky sunrise sunset dawn dusk weather clouds horizon skyline goldenHour twilight
    morning evening breeze rain storm mist fog rainbow daybreak afterglow skyWatching cloudscape
    sunbeam golden glow moonlight starlight`),
  nature: words(`nature wildflowers forest ocean mountains meadow river garden petals blossom
    seasons spring autumn moss earth wilderness sunlight waves shoreline harvest dew breeze
    stardust sunbeam daybreak sunflower lavender`),
  poetry: words(`poetry beauty verse poem lyrical haiku prose muse wordsmith metaphor stanza poet
    imagery serenity wonder reverie elegance grace whisper dream moment memory tenderness longing
    timelessBeauty light glow rhyme lyric`),
};

interface Node {
  label: string;
  near: Set<string>;
}

const buildGraph = (): Map<string, Node> => {
  const graph = new Map<string, Node>();
  for (const terms of Object.values(THEMES)) {
    for (const term of terms) {
      const node = graph.get(tagKey(term)) ?? { label: term, near: new Set<string>() };
      graph.set(tagKey(term), node);
      for (const other of terms) if (tagKey(other) !== tagKey(term)) node.near.add(other);
    }
  }
  return graph;
};

const GRAPH = buildGraph();

/** Every distinct term in the graph. */
export const ALL_TERMS: readonly string[] = [...GRAPH.values()].map((n) => n.label);

/** Neighbours of `tag` (any casing); empty when the tag is not a known term. */
export const relatedTerms = (tag: string): string[] => [...(GRAPH.get(tagKey(tag))?.near ?? [])];
