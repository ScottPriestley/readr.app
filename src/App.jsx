import { useEffect, useState, useRef } from 'react';
import InfiniteScroll from 'react-infinite-scroll-component';
import { supabase } from './supabaseClient';

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function recordInteraction(userId, articleId, interactionType, detail = null) {
  await supabase.from('user_interactions').insert({
    user_id: userId,
    article_id: articleId,
    interaction_type: interactionType,
    detail: detail,
  });
}

async function updatePreference(userId, topic, source, delta) {
  const { data } = await supabase
    .from('user_preferences')
    .select('*')
    .eq('user_id', userId)
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
      user_id: userId,
      topic: topic || null,
      source: source || null,
      preference_score: Math.max(-1, Math.min(1, delta)),
    });
  }
}

async function normaliseTopics(rawTopics) {
  const response = await fetch('/api/normalise-topics', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ topics: rawTopics }),
  });
  const data = await response.json();
  return data.normalised || rawTopics;
}

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content || '[]';
  try {
    return JSON.parse(text);
  } catch {
    return rawTopics; // fall back to raw input if parsing fails
  }
}

function decodeHTML(text) {
  const doc = new DOMParser().parseFromString(text, 'text/html');
  let decoded = doc.documentElement.textContent;
  decoded = decoded.replace(/\s[-|].*$/, '').trim();
  return decoded;
}

// ─── Curated Topics ───────────────────────────────────────────────────────────

const CURATED_TOPICS = [
  'Technology', 'Artificial Intelligence', 'Science', 'Space', 'Health',
  'Politics', 'World News', 'Business', 'Finance', 'Stock Market',
  'Sports', 'NFL', 'NBA', 'Soccer', 'Formula 1',
  'Climate', 'Environment', 'Entertainment', 'Film', 'Music',
  'Gaming', 'Food', 'Travel', 'History', 'Law & Crime',
];

// ─── Auth Screen ──────────────────────────────────────────────────────────────

function AuthScreen() {
  const [mode, setMode] = useState('login'); // 'login' | 'signup'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(null);

  async function handleSubmit() {
    setLoading(true);
    setError(null);
    setSuccess(null);

    if (mode === 'signup') {
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) setError(error.message);
      else setSuccess('Account created! You are now signed in.');
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setError(error.message);
    }
    setLoading(false);
  }

  return (
    <div className="bg-gray-900 min-h-screen flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <h1 className="text-4xl font-bold text-white mb-1">Readr</h1>
        <p className="text-gray-400 text-sm mb-8">Your personalised news feed</p>

        <div className="flex rounded-xl overflow-hidden border border-gray-700 mb-6">
          <button
            onClick={() => setMode('login')}
            className={`flex-1 py-2 text-sm font-medium transition-colors ${mode === 'login' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'}`}
          >Sign In</button>
          <button
            onClick={() => setMode('signup')}
            className={`flex-1 py-2 text-sm font-medium transition-colors ${mode === 'signup' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'}`}
          >Create Account</button>
        </div>

        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          className="w-full bg-gray-800 text-white rounded-xl px-4 py-3 text-sm mb-3 outline-none border border-gray-700 focus:border-blue-500"
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSubmit()}
          className="w-full bg-gray-800 text-white rounded-xl px-4 py-3 text-sm mb-4 outline-none border border-gray-700 focus:border-blue-500"
        />

        {error && <p className="text-red-400 text-xs mb-3">{error}</p>}
        {success && <p className="text-green-400 text-xs mb-3">{success}</p>}

        <button
          onClick={handleSubmit}
          disabled={loading || !email || !password}
          className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white font-semibold rounded-xl py-3 text-sm transition-colors"
        >
          {loading ? 'Please wait...' : mode === 'signup' ? 'Create Account' : 'Sign In'}
        </button>
      </div>
    </div>
  );
}

// ─── Onboarding Screen ────────────────────────────────────────────────────────

function OnboardingScreen({ userId, onComplete }) {
  const [selected, setSelected] = useState(new Set());
  const [customLike, setCustomLike] = useState('');
  const [customNever, setCustomNever] = useState('');
  const [neverList, setNeverList] = useState([]);
  const [likeList, setLikeList] = useState([]);
  const [saving, setSaving] = useState(false);

  function toggleTopic(topic) {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(topic) ? next.delete(topic) : next.add(topic);
      return next;
    });
  }

  function addCustomLike() {
    const trimmed = customLike.trim();
    if (trimmed && !likeList.includes(trimmed)) {
      setLikeList(prev => [...prev, trimmed]);
    }
    setCustomLike('');
  }

  function addCustomNever() {
    const trimmed = customNever.trim();
    if (trimmed && !neverList.includes(trimmed)) {
      setNeverList(prev => [...prev, trimmed]);
    }
    setCustomNever('');
  }

  async function handleComplete() {
    setSaving(true);

    // Combine curated selections + custom likes
    const allLikeTopics = [...selected];

    // Normalise custom like topics through AI if any were entered
    let normalisedCustom = [];
    if (likeList.length > 0) {
      normalisedCustom = await normaliseTopics(likeList);
    }

    // Normalise never topics through AI if any were entered
    let normalisedNever = [];
    if (neverList.length > 0) {
      normalisedNever = await normaliseTopics(neverList);
    }

    const allLike = [...new Set([...allLikeTopics, ...normalisedCustom])];
    const allNever = [...new Set(normalisedNever)];

    // Write like preferences at +0.5
    for (const topic of allLike) {
      await updatePreference(userId, topic.toLowerCase(), null, 0.5);
    }

    // Write never preferences at -1.0
    for (const topic of allNever) {
      await updatePreference(userId, topic.toLowerCase(), null, -1.0);
    }

    // Mark onboarding complete in user metadata
    await supabase.auth.updateUser({ data: { onboarded: true } });

    setSaving(false);
    onComplete();
  }

  return (
    <div className="bg-gray-900 min-h-screen px-4 py-8">
      <div className="max-w-md mx-auto">
        <h1 className="text-2xl font-bold text-white mb-1">Set up your feed</h1>
        <p className="text-gray-400 text-sm mb-6">Tell us what you're interested in. You can always change this later.</p>

        {/* Curated grid */}
        <p className="text-white font-semibold text-sm mb-3">Pick your interests</p>
        <div className="flex flex-wrap gap-2 mb-6">
          {CURATED_TOPICS.map(topic => (
            <button
              key={topic}
              onClick={() => toggleTopic(topic)}
              className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                selected.has(topic)
                  ? 'bg-blue-600 border-blue-600 text-white'
                  : 'bg-gray-800 border-gray-700 text-gray-300 hover:border-gray-500'
              }`}
            >
              {topic}
            </button>
          ))}
        </div>

        {/* Custom likes */}
        <p className="text-white font-semibold text-sm mb-2">Add your own</p>
        <div className="flex gap-2 mb-2">
          <input
            type="text"
            placeholder="e.g. Formula 1, K-Pop, Crypto..."
            value={customLike}
            onChange={e => setCustomLike(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addCustomLike()}
            className="flex-1 bg-gray-800 text-white rounded-xl px-4 py-2.5 text-sm outline-none border border-gray-700 focus:border-blue-500"
          />
          <button
            onClick={addCustomLike}
            className="bg-gray-700 hover:bg-gray-600 text-white rounded-xl px-4 py-2.5 text-sm"
          >Add</button>
        </div>
        {likeList.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-4">
            {likeList.map(t => (
              <span key={t} className="bg-blue-600 text-white text-xs px-3 py-1 rounded-full flex items-center gap-1">
                {t}
                <button onClick={() => setLikeList(prev => prev.filter(x => x !== t))} className="ml-1 opacity-70 hover:opacity-100">✕</button>
              </span>
            ))}
          </div>
        )}

        {/* Never show */}
        <p className="text-white font-semibold text-sm mb-2 mt-4">Never show me</p>
        <p className="text-gray-500 text-xs mb-2">Topics you never want to see in your feed</p>
        <div className="flex gap-2 mb-2">
          <input
            type="text"
            placeholder="e.g. Sports, Politics..."
            value={customNever}
            onChange={e => setCustomNever(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addCustomNever()}
            className="flex-1 bg-gray-800 text-white rounded-xl px-4 py-2.5 text-sm outline-none border border-gray-700 focus:border-red-500"
          />
          <button
            onClick={addCustomNever}
            className="bg-gray-700 hover:bg-gray-600 text-white rounded-xl px-4 py-2.5 text-sm"
          >Add</button>
        </div>
        {neverList.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-4">
            {neverList.map(t => (
              <span key={t} className="bg-red-900 text-red-300 text-xs px-3 py-1 rounded-full flex items-center gap-1">
                {t}
                <button onClick={() => setNeverList(prev => prev.filter(x => x !== t))} className="ml-1 opacity-70 hover:opacity-100">✕</button>
              </span>
            ))}
          </div>
        )}

        <button
          onClick={handleComplete}
          disabled={saving}
          className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white font-semibold rounded-xl py-3 text-sm mt-6 transition-colors"
        >
          {saving ? 'Setting up your feed...' : 'Take me to my feed →'}
        </button>

        <button
          onClick={onComplete}
          className="w-full text-gray-500 text-xs mt-3 hover:text-gray-400"
        >
          Skip for now
        </button>
      </div>
    </div>
  );
}

// ─── Action Menu ──────────────────────────────────────────────────────────────

function ActionMenu({ article, userId, onClose, onHide }) {
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
        await recordInteraction(userId, article.id, 'more_topic', topic);
        if (topic) await updatePreference(userId, topic, null, 0.3);
        onClose();
      }
    },
    {
      label: `Less like "${topic || 'this topic'}"`,
      action: async () => {
        await recordInteraction(userId, article.id, 'less_topic', topic);
        if (topic) await updatePreference(userId, topic, null, -0.3);
        onClose();
      }
    },
    {
      label: `More from ${source}`,
      action: async () => {
        await recordInteraction(userId, article.id, 'more_source', source);
        if (source) await updatePreference(userId, null, source, 0.3);
        onClose();
      }
    },
    {
      label: `Less from ${source}`,
      action: async () => {
        await recordInteraction(userId, article.id, 'less_source', source);
        if (source) await updatePreference(userId, null, source, -0.3);
        onClose();
      }
    },
    {
      label: `Never show from ${source}`,
      danger: true,
      action: async () => {
        await recordInteraction(userId, article.id, 'never_source', source);
        if (source) await updatePreference(userId, null, source, -1);
        onHide(article.id);
        onClose();
      }
    },
  ];

  const [openUpward, setOpenUpward] = useState(true);

  useEffect(() => {
    if (menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect();
      setOpenUpward(rect.top > 200);
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

// ─── Article Card ─────────────────────────────────────────────────────────────

function ArticleCard({ article, userId, onHide }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [reaction, setReaction] = useState(null);

  async function handleLike() {
    setReaction('like');
    await recordInteraction(userId, article.id, 'like');
    if (article.topics?.[0]) await updatePreference(userId, article.topics[0], null, 0.2);
  }

  async function handleDislike() {
    setReaction('dislike');
    await recordInteraction(userId, article.id, 'dislike');
    if (article.topics?.[0]) await updatePreference(userId, article.topics[0], null, -0.2);
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
                  userId={userId}
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
               article.topics?.[0] === 'food' ? '🍕' : '📰'}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────

function App() {
  const [session, setSession] = useState(undefined); // undefined = loading
  const [screen, setScreen] = useState('loading'); // 'loading' | 'auth' | 'onboarding' | 'feed'
  const [articles, setArticles] = useState([]);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const PAGE_SIZE = 10;

  // Listen for auth state changes
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (!session) {
        setScreen('auth');
      } else if (!session.user.user_metadata?.onboarded) {
        setScreen('onboarding');
      } else {
        setScreen('feed');
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (!session) {
        setScreen('auth');
        setArticles([]);
      } else if (!session.user.user_metadata?.onboarded) {
        setScreen('onboarding');
      } else {
        setScreen('feed');
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // Fetch articles once we hit the feed screen
  useEffect(() => {
    if (screen === 'feed' && session) {
      fetchArticles(0);
    }
  }, [screen]);

  const userId = session?.user?.id;

  async function fetchArticles(pageNum) {
    const from = pageNum * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    const [{ data: articlesData, error }, { data: prefs }] = await Promise.all([
      supabase.from('articles').select('*').order('created_at', { ascending: false }).range(from, to),
      supabase.from('user_preferences').select('*').eq('user_id', userId)
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
        const rankRes = await fetch(`/api/rank?user_id=${userId}`);
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

  function loadMore() {
    const nextPage = page + 1;
    setPage(nextPage);
    fetchArticles(nextPage);
  }

  function hideArticle(id) {
    setArticles(prev => prev.filter(a => a.id !== id));
  }

  // ── Render ──

  if (screen === 'loading') {
    return (
      <div className="bg-gray-900 min-h-screen flex items-center justify-center">
        <p className="text-gray-500 text-sm">Loading...</p>
      </div>
    );
  }

  if (screen === 'auth') {
    return <AuthScreen />;
  }

  if (screen === 'onboarding') {
    return (
      <OnboardingScreen
        userId={userId}
        onComplete={() => setScreen('feed')}
      />
    );
  }

  return (
    <div className="bg-gray-900 min-h-screen">
      <div className="max-w-md mx-auto px-3 py-4">
        <div className="flex items-center justify-between mb-4 px-1">
          <h1 className="text-2xl font-bold text-white">For You</h1>
          <button
            onClick={() => supabase.auth.signOut()}
            className="text-gray-500 text-xs hover:text-gray-300"
          >Sign out</button>
        </div>
        {error && <p className="text-red-400 text-sm mb-4">{error}</p>}
        <InfiniteScroll
          dataLength={articles.length}
          next={loadMore}
          hasMore={hasMore}
          loader={<div className="text-center py-4 text-gray-500 text-sm">Loading more...</div>}
          endMessage={<div className="text-center py-4 text-gray-500 text-sm">You're all caught up!</div>}
        >
          {articles.map(article => (
            <ArticleCard key={article.id} article={article} userId={userId} onHide={hideArticle} />
          ))}
        </InfiniteScroll>
      </div>
    </div>
  );
}

export default App;