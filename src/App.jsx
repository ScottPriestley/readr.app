import { useEffect, useState, useRef } from 'react';
import InfiniteScroll from 'react-infinite-scroll-component';
import { supabase } from './supabaseClient';

const USER_ID = '00000000-0000-0000-0000-000000000001';

async function recordInteraction(articleId, interactionType, detail = null) {
  await supabase.from('user_interactions').insert({
    user_id: USER_ID,
    article_id: articleId,
    interaction_type: interactionType,
    detail: detail,
  });
}

async function updatePreference(topic, source, delta) {
  const { data } = await supabase
    .from('user_preferences')
    .select('*')
    .eq('user_id', USER_ID)
    .eq('topic', topic || null)
    .eq('source', source || null)
    .maybeSingle();

  if (data) {
    const newScore = Math.max(-1, Math.min(1, (data.preference_score || 0) + delta));
    await supabase
      .from('user_preferences')
      .update({ preference_score: newScore, last_updated: new Date().toISOString() })
      .eq('id', data.id);
  } else {
    await supabase.from('user_preferences').insert({
      user_id: USER_ID,
      topic: topic || null,
      source: source || null,
      preference_score: delta,
    });
  }
}

function decodeHTML(text) {
  const doc = new DOMParser().parseFromString(text, 'text/html');
  let decoded = doc.documentElement.textContent;
  decoded = decoded.replace(/\s[-|].*$/, '').trim();
  return decoded;
}

function ActionMenu({ article, onClose, onHide }) {
  const menuRef = useRef();

  useEffect(() => {
    function handleClickOutside(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) onClose();
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  const topic = article.topics?.[0] || null;
  const source = article.source || null;

  const options = [
    {
      label: `More like "${topic || 'this topic'}"`,
      action: async () => {
        await recordInteraction(article.id, 'more_topic', topic);
        if (topic) await updatePreference(topic, null, 0.3);
        onClose();
      }
    },
    {
      label: `Less like "${topic || 'this topic'}"`,
      action: async () => {
        await recordInteraction(article.id, 'less_topic', topic);
        if (topic) await updatePreference(topic, null, -0.3);
        onClose();
      }
    },
    {
      label: `More from ${source}`,
      action: async () => {
        await recordInteraction(article.id, 'more_source', source);
        if (source) await updatePreference(null, source, 0.3);
        onClose();
      }
    },
    {
      label: `Less from ${source}`,
      action: async () => {
        await recordInteraction(article.id, 'less_source', source);
        if (source) await updatePreference(null, source, -0.3);
        onClose();
      }
    },
    {
      label: `Never show from ${source}`,
      danger: true,
      action: async () => {
        await recordInteraction(article.id, 'never_source', source);
        if (source) await updatePreference(null, source, -1);
        onHide(article.id);
        onClose();
      }
    },
  ];

 const [openUpward, setOpenUpward] = useState(true);

useEffect(() => {
  if (menuRef.current) {
    const rect = menuRef.current.getBoundingClientRect();
    // If menu would go above the viewport, flip it downward
    setOpenUpward(rect.top > 0);
  }
}, []);

return (
  <div
    ref={menuRef}
    className={`absolute right-3 ${openUpward ? 'bottom-12' : 'top-12'} bg-gray-800 rounded-xl shadow-xl border border-gray-700 z-[9999] w-[calc(100vw-2rem)] max-w-64 overflow-hidden`}
  >
    {options.map(opt => (
      <button
        key={opt.label}
        onClick={opt.action}
        className={`w-full text-left px-4 py-3 text-sm hover:bg-gray-700 border-b border-gray-700 last:border-0 ${opt.danger ? 'text-red-400' : 'text-gray-200'}`}
      >
        {opt.label}
      </button>
    ))}
  </div>
);
}

function ArticleCard({ article, onHide }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [reaction, setReaction] = useState(null);

  async function handleLike() {
    setReaction('like');
    await recordInteraction(article.id, 'like');
    if (article.topics?.[0]) await updatePreference(article.topics[0], null, 0.2);
  }

  async function handleDislike() {
    setReaction('dislike');
    await recordInteraction(article.id, 'dislike');
    if (article.topics?.[0]) await updatePreference(article.topics[0], null, -0.2);
  }

  return (
    <div className="bg-gray-800 rounded-2xl shadow-md mb-3 overflow-visible relative">
      <div className="flex p-4 gap-3">
        <div className="flex-1 flex flex-col justify-between">
          <div>
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">
              {article.source || 'Unknown Source'}
            </p>
            <a href={article.url} target="_blank" rel="noopener noreferrer">
              <h2 className="text-sm font-semibold text-white leading-snug hover:text-blue-400">
                {decodeHTML(article.title)}
              </h2>
            </a>
          </div>
          <div className="flex items-center gap-3 mt-3">
            <button
              onClick={handleLike}
              className={`text-lg transition-transform hover:scale-110 ${reaction === 'like' ? 'opacity-100' : 'opacity-40'}`}
            >👍</button>
            <button
              onClick={handleDislike}
              className={`text-lg transition-transform hover:scale-110 ${reaction === 'dislike' ? 'opacity-100' : 'opacity-40'}`}
            >👎</button>
            <div className="static ml-auto">
              <button
                onClick={() => setMenuOpen(v => !v)}
                className="text-gray-500 text-xl px-1 hover:text-gray-300"
              >⋯</button>
              {menuOpen && (
                <ActionMenu
                  article={article}
                  onClose={() => setMenuOpen(false)}
                  onHide={onHide}
                />
              )}
            </div>
          </div>
        </div>
        {article.image_url ? (
          <img
            src={article.image_url}
            alt={article.title}
            className="w-24 h-24 object-cover rounded-xl flex-shrink-0"
            onError={e => { e.target.style.display = 'none'; }}
          />
        ) : (
          <div className="w-24 h-24 rounded-xl flex-shrink-0 bg-gray-700 flex items-center justify-center">
            <span className="text-3xl">
              {article.topics?.[0] === 'technology' ? '💻' :
               article.topics?.[0] === 'science' ? '🔬' :
               article.topics?.[0] === 'space' ? '🚀' :
               article.topics?.[0] === 'health' ? '🏃' :
               article.topics?.[0] === 'food' ? '🍕' :
               article.topics?.[0] === 'religion' ? '🛐' : '📰'}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function App() {
  const [articles, setArticles] = useState([]);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const PAGE_SIZE = 10;

  async function fetchArticles(pageNum) {
    const from = pageNum * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    const [{ data: articlesData, error }, { data: prefs }] = await Promise.all([
      supabase.from('articles').select('*').order('created_at', { ascending: false }).range(from, to),
      supabase.from('user_preferences').select('*').eq('user_id', USER_ID)
    ]);

    if (error) { setError(error.message); return; }

    const topicScores = {};
    const sourceScores = {};
    if (prefs) {
      for (const p of prefs) {
        if (p.topic) topicScores[p.topic] = p.preference_score;
        if (p.source) sourceScores[p.source] = p.preference_score;
      }
    }

    const filtered = articlesData.filter(a => (sourceScores[a.source] ?? 0) > -1);

    try {
      const hasInteractions = prefs && prefs.length > 0;
      if (hasInteractions) {
        const rankRes = await fetch(`/api/rank?user_id=${USER_ID}`);
        const { ranked } = await rankRes.json();

        if (ranked && ranked.length > 0) {
          const articleMap = Object.fromEntries(filtered.map(a => [a.id, a]));
          const aiRanked = ranked.filter(id => articleMap[id]).map(id => articleMap[id]);
          const aiRankedIds = new Set(ranked);
          const remainder = filtered.filter(a => !aiRankedIds.has(a.id));
          const final = [...aiRanked, ...remainder];

          if (final.length < PAGE_SIZE) setHasMore(false);
          setArticles(prev => {
            const existingIds = new Set(prev.map(a => a.id));
            return [...prev, ...final.filter(a => !existingIds.has(a.id))];
          });
          return;
        }
      }
    } catch (e) {
      console.log('AI ranking failed, using fallback', e);
    }

    const scored = filtered
      .map(a => {
        let score = 0;
        if (a.topics) for (const t of a.topics) score += topicScores[t] ?? 0;
        score += sourceScores[a.source] ?? 0;
        return { ...a, _score: score };
      })
      .sort((a, b) => b._score - a._score);

    if (scored.length < PAGE_SIZE) setHasMore(false);
    setArticles(prev => {
      const existingIds = new Set(prev.map(a => a.id));
      return [...prev, ...scored.filter(a => !existingIds.has(a.id))];
    });
  }

  useEffect(() => {
    fetchArticles(0);
  }, []);

  function loadMore() {
    const nextPage = page + 1;
    setPage(nextPage);
    fetchArticles(nextPage);
  }

  function hideArticle(id) {
    setArticles(prev => prev.filter(a => a.id !== id));
  }

  return (
    <div className="bg-gray-900 min-h-screen">
      <div className="max-w-md mx-auto px-3 py-4">
        <h1 className="text-2xl font-bold text-white mb-4 px-1">For You</h1>
        {error && <p className="text-red-400 text-sm mb-4">{error}</p>}
        <InfiniteScroll
          dataLength={articles.length}
          next={loadMore}
          hasMore={hasMore}
          loader={<div className="text-center py-4 text-gray-500 text-sm">Loading more...</div>}
          endMessage={<div className="text-center py-4 text-gray-500 text-sm">You're all caught up!</div>}
        >
          {articles.map(article => (
            <ArticleCard key={article.id} article={article} onHide={hideArticle} />
          ))}
        </InfiniteScroll>
      </div>
    </div>
  );
}

export default App;