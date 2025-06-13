// app/explore.tsx

import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  ImageBackground,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  ActivityIndicator,
  Alert,
  PanResponder,
  Linking,
  ScrollView,
  Dimensions,
} from 'react-native';
import { Ionicons, Feather, FontAwesome } from '@expo/vector-icons';

/**
 * ─── CATEGORY LIST ──────────────────────────────────────────────────────────────
 */
const CATEGORIES = ['Finance', 'History', 'World', 'Politics', 'Random'];

/**
 * ─── PLACEHOLDER ARTICLES (Mock Data) ─────────────────────────────────────────────
 * Each entry now has a non‐null thumbnailUri. 
 * “Random” will be populated by flattening all others on first render.
 */
interface ArticlePayload {
  title: string;
  extract: string;
  thumbnailUri: string;   // always non‐null now
  pageUrl: string;
}

const PLACEHOLDER_ARTICLES: Record<string, ArticlePayload[]> = {
  Finance: [
    {
      title: 'Stock Market Rally Amid Economic Recovery',
      extract:
        'Global stock markets are experiencing a remarkable rally as economies reopen and vaccination rates climb. Analysts point to strong earnings reports from major corporations, particularly in the technology and financial sectors. However, some experts caution that high valuations could lead to increased volatility if inflationary pressures continue to rise.',
      thumbnailUri:
        'https://images.pexels.com/photos/210607/pexels-photo-210607.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=750&w=1260',
      pageUrl: 'https://en.wikipedia.org/wiki/Stock_market',
    },
    {
      title: 'Cryptocurrency Adoption in Developing Countries',
      extract:
        'Several developing nations are seeing a surge in cryptocurrency usage as citizens seek alternatives to unstable local currencies. Remittances via Bitcoin and stablecoins are becoming more common, bypassing traditional banking systems and reducing transaction fees. Regulators are still catching up with proper frameworks.',
      thumbnailUri:
        'https://images.pexels.com/photos/315788/pexels-photo-315788.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=750&w=1260',
      pageUrl: 'https://en.wikipedia.org/wiki/Cryptocurrency',
    },
  ],
  History: [
    {
      title: 'Fall of the Berlin Wall',
      extract:
        'On November 9, 1989, the Berlin Wall—dividing East and West Berlin for nearly three decades—was opened, marking the beginning of German reunification and the symbolic end of the Cold War. Thousands of East Germans crossed into West Berlin in jubilant celebration, and within a year, Germany was officially reunified.',
      thumbnailUri:
        'https://upload.wikimedia.org/wikipedia/commons/4/4c/West_and_East_Germans_at_the_Brandenburg_Gate_in_1989.jpg',
      pageUrl: 'https://en.wikipedia.org/wiki/Berlin_Wall',
    },
    {
      title: 'The Renaissance Era',
      extract:
        'Spanning roughly from the 14th to the 17th century, the Renaissance was a period of cultural rebirth in Europe, originating in Italy. It saw revolutionary developments in art, literature, science, and philosophy. Notable figures include Leonardo da Vinci, Michelangelo, and Galileo Galilei, whose works laid the foundation for the modern age.',
      thumbnailUri:
        'https://upload.wikimedia.org/wikipedia/commons/6/6a/Leonardo_da_Vinci_-_Vitruvian_Man.jpg',
      pageUrl: 'https://en.wikipedia.org/wiki/Renaissance',
    },
  ],
  World: [
    {
      title: 'Global Climate Change Summit 2024',
      extract:
        'World leaders convened for the 2024 Climate Change Summit in Geneva to negotiate binding commitments on carbon emissions reductions. Key outcomes included increased funding for renewable energy projects in developing nations and a pledge to phase out coal power by 2040. Environmental NGOs called for even more aggressive action.',
      thumbnailUri:
        'https://images.pexels.com/photos/1598663/pexels-photo-1598663.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=750&w=1260',
      pageUrl:
        'https://en.wikipedia.org/wiki/United_Nations_Climate_Change_Conference',
    },
    {
      title: 'Mars Rover Discovers Ancient Riverbed',
      extract:
        'NASA’s latest Mars rover has uncovered fossilized riverbeds near the planet’s equator, suggesting that liquid water once flowed on the surface. The discovery strengthens the possibility that microbial life could have existed on ancient Mars. Scientists plan to collect samples for a future return mission.',
      thumbnailUri:
        'https://images.pexels.com/photos/5472140/pexels-photo-5472140.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=750&w=1260',
      pageUrl: 'https://en.wikipedia.org/wiki/Mars_rover',
    },
  ],
  Politics: [
    {
      title: 'New Trade Deal Signed Between Nations',
      extract:
        'In a landmark agreement, Country A and Country B signed a new free-trade deal aimed at reducing tariffs on agricultural exports and technology products. The deal is expected to boost GDP growth by up to 2% annually and strengthen diplomatic ties. Critics warn about potential impacts on local industries.',
      thumbnailUri:
        'https://images.pexels.com/photos/3226200/pexels-photo-3226200.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=750&w=1260',
      pageUrl: 'https://en.wikipedia.org/wiki/Free_trade',
    },
    {
      title: 'Election Reform Debate Heats Up',
      extract:
        'Debate over proposed election reforms has intensified as legislators propose changes to voter ID laws and campaign finance rules. Supporters say the reforms will curb fraud and increase transparency, while opponents argue they may disenfranchise minority voters.',
      thumbnailUri:
        'https://images.pexels.com/photos/1264075/pexels-photo-1264075.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=750&w=1260',
      pageUrl: 'https://en.wikipedia.org/wiki/Election',
    },
  ],
  Random: [], // populated once below
};

/**
 * ─── EXPLORE SCREEN COMPONENT (Default Export) ───────────────────────────────────
 */
export default function ExploreScreen() {
  // On first render, flatten all non‐“Random” lists into PLACEHOLDER_ARTICLES.Random
  useEffect(() => {
    if (PLACEHOLDER_ARTICLES.Random.length === 0) {
      const all: ArticlePayload[] = [];
      for (const key of CATEGORIES) {
        if (key === 'Random') continue;
        all.push(...PLACEHOLDER_ARTICLES[key]);
      }
      PLACEHOLDER_ARTICLES.Random = all;
    }
  }, []);

  const [selectedCategory, setSelectedCategory] = useState<string>('Random');
  const [loading, setLoading] = useState<boolean>(true);
  const [articleData, setArticleData] = useState<ArticlePayload | null>(null);
  const panResponder = useRef<any>(null);

  // Whenever the category changes (or on mount), load a new placeholder
  useEffect(() => {
    loadNextArticle();
  }, [selectedCategory]);

  /**
   * ─── loadNextArticle ───────────────────────────────────────────────────────────
   * Instead of calling a backend, we pick a random object
   * from PLACEHOLDER_ARTICLES[selectedCategory].
   */
  const loadNextArticle = () => {
    setLoading(true);

    try {
      const pool = PLACEHOLDER_ARTICLES[selectedCategory] || [];
      if (pool.length === 0) {
        throw new Error(`No placeholders for category "${selectedCategory}"`);
      }
      const randomIndex = Math.floor(Math.random() * pool.length);
      const next = pool[randomIndex];

      // Simulate a brief delay so ActivityIndicator is visible
      setTimeout(() => {
        setArticleData(next);
        setLoading(false);
      }, 300);
    } catch (err) {
      console.warn(err);
      Alert.alert(
        'Error',
        `Could not load a placeholder for "${selectedCategory}".`
      );
      setArticleData(null);
      setLoading(false);
    }
  };

  /**
   * ─── handleSwipeLeft ────────────────────────────────────────────────────────────
   * Called when the user swipes left on the card.
   */
  const handleSwipeLeft = () => {
    loadNextArticle();
  };

  /**
   * ─── handleReadMore ─────────────────────────────────────────────────────────────
   * Opens the article’s pageUrl in the device’s browser.
   */
  const handleReadMore = () => {
    if (articleData?.pageUrl) {
      Linking.openURL(articleData.pageUrl).catch((e) => {
        console.warn('Failed to open URL:', e);
      });
    }
  };

  /**
   * ─── Build a PanResponder to detect left swipe (dx < -50) ────────────────────────
   */
  useEffect(() => {
    panResponder.current = PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_evt, gestureState) => {
        return Math.abs(gestureState.dx) > Math.abs(gestureState.dy);
      },
      onPanResponderRelease: (_evt, gestureState) => {
        if (gestureState.dx < -50) {
          handleSwipeLeft();
        }
      },
    });
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      {/* ─── HEADER ──────────────────────────────────────────────────────────────── */}
      <View style={styles.header}>
        <View style={styles.spacer} />
        <Text style={styles.headerTitle}>Explore</Text>
        <TouchableOpacity style={styles.settingsButton}>
          <Feather name="settings" size={24} color="#101619" />
        </TouchableOpacity>
      </View>

      {/* ─── MAIN BODY ────────────────────────────────────────────────────────────── */}
      <View style={styles.exploreBody}>
        {loading ? (
          // Show spinner while we “load” a placeholder
          <ActivityIndicator
            size="large"
            color="#101619"
            style={{ flex: 1 }}
          />
        ) : articleData ? (
          <View
            style={styles.cardWrapper}
            {...panResponder.current.panHandlers}
          >
            {/* ── HERO IMAGE + TAGS OVERLAY ────────────────────────────────── */}
            <ImageBackground
              source={{
                uri: articleData.thumbnailUri, 
                // Guaranteed non-null in our placeholders
              }}
              style={styles.heroImage}
              imageStyle={styles.heroImageRounded}
            >
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.tagScroll}
                contentContainerStyle={{ alignItems: 'center' }}
              >
                {CATEGORIES.map((cat) => {
                  const isSelected = cat === selectedCategory;
                  return (
                    <TouchableOpacity
                      key={cat}
                      onPress={() => setSelectedCategory(cat)}
                      style={[
                        styles.categoryTag,
                        isSelected && styles.categoryTagSelected,
                      ]}
                    >
                      <Text
                        style={[
                          styles.categoryTagText,
                          isSelected && styles.categoryTagTextSelected,
                        ]}
                      >
                        {cat}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </ImageBackground>

            {/* ── ARTICLE TITLE & SUMMARY ─────────────────────────────────────── */}
            <View style={styles.articleContent}>
              <Text style={styles.articleTitle}>{articleData.title}</Text>
              <ScrollView style={{ flex: 1, marginBottom: 8 }}>
                <Text style={styles.articleBody}>{articleData.extract}</Text>
              </ScrollView>
              <TouchableOpacity
                style={styles.readMoreButton}
                onPress={handleReadMore}
              >
                <Text style={styles.readMoreText}>
                  Read More on Wikipedia
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          // Empty / Error state (unlikely with placeholders)
          <View style={styles.emptyState}>
            <Text style={{ color: '#577c8e' }}>No article to show.</Text>
            <TouchableOpacity
              onPress={loadNextArticle}
              style={styles.retryButton}
            >
              <Text style={styles.retryText}>Try Again</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

    </SafeAreaView>
  );
}

/**
 * ─── STYLES ───────────────────────────────────────────────────────────────────
 */
const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CARD_HORIZONTAL_MARGIN = 16;
const CARD_VERTICAL_MARGIN = 16;

const styles = StyleSheet.create({
  // ─── CONTAINER ───────────────────────────────────────────────────────────────
  container: {
    flex: 1,
    backgroundColor: '#f3f5f6',
  },

  // ─── HEADER ─────────────────────────────────────────────────────────────────
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 56,
    paddingHorizontal: 16,
    backgroundColor: '#f3f5f6',
    borderBottomWidth: 1,
    borderBottomColor: '#e9eff1',
  },
  spacer: {
    width: 24,
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 18,
    fontWeight: '700',
    color: '#101619',
  },
  settingsButton: {
    width: 24,
    alignItems: 'flex-end',
  },

  // ─── MAIN BODY ──────────────────────────────────────────────────────────────
  exploreBody: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: CARD_HORIZONTAL_MARGIN,
    paddingVertical: CARD_VERTICAL_MARGIN,
  },

  // ─── CARD WRAPPER ───────────────────────────────────────────────────────────
  cardWrapper: {
    flex: 1,
    width: SCREEN_WIDTH - 2 * CARD_HORIZONTAL_MARGIN,
    backgroundColor: '#ffffff',
    borderRadius: 12,
    overflow: 'hidden',
    // iOS shadow
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    // Android elevation
    elevation: 3,
  },

  // ─── HERO IMAGE + TAGS ──────────────────────────────────────────────────────
  heroImage: {
    width: '100%',
    height: '35%', // ~35% of card height
    justifyContent: 'flex-start',
  },
  heroImageRounded: {
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
  },
  tagScroll: {
    position: 'absolute',
    top: 8,
    left: 8,
    right: 8,
  },
  categoryTag: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: 'rgba(255,255,255,0.75)',
    borderRadius: 16,
    marginRight: 8,
  },
  categoryTagSelected: {
    backgroundColor: '#add6ea',
  },
  categoryTagText: {
    color: '#101619',
    fontSize: 13,
    fontWeight: '600',
  },
  categoryTagTextSelected: {
    color: '#101619',
    fontWeight: '700',
  },

  // ─── ARTICLE CONTENT ─────────────────────────────────────────────────────────
  articleContent: {
    flex: 1,
    padding: 12,
  },
  articleTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#101619',
    marginBottom: 8,
  },
  articleBody: {
    fontSize: 14,
    lineHeight: 20,
    color: '#577c8e',
  },
  readMoreButton: {
    marginTop: 12,
    paddingVertical: 10,
    alignItems: 'center',
    backgroundColor: '#add6ea',
    borderRadius: 20,
  },
  readMoreText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#101619',
  },

  // ─── EMPTY / ERROR STATE ─────────────────────────────────────────────────────
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  retryButton: {
    marginTop: 12,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#e9eff1',
    borderRadius: 20,
  },
  retryText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#101619',
  }
});
