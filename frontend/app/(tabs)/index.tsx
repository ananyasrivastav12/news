// app/index.tsx  (or rename to App.js if you’re not using Expo Router)

import React, { useState } from 'react';
import {
  View,
  Text,
  ImageBackground,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
} from 'react-native';
import { Ionicons, Feather, FontAwesome } from '@expo/vector-icons';

// A small sample list of articles:
const ARTICLES = [
  {
    id: '1',
    imageUri:
      'https://lh3.googleusercontent.com/aida-public/AB6AXuCvVB5eeppRvAyf594ZczILMHVBLeL3CIH3uXRp2C51T55eYVrYVYfXVG4GY-y1f4jKaJfyi1hi-QZG6KBj0XR1m0oWw8MAXADppzTSvAsj10ZhlneXjakeV-IuduYbQX8OeM09md7eRF1byfdORAMGoiGJIvDPfLolMDIM9cbqBFU3g9P7d60SdBgxIAZF9U-cCLC_irUn2wYe0DR-lnTOtohSQwBT54w8RFIx8eSwaDo38BMgxJZPFvUyQx0TALJuZU01oWAS6FNb',
    title: 'Tech Giant Unveils New AI Assistant',
    body: `In a groundbreaking move, a leading tech company has introduced its latest AI assistant, promising to revolutionize personal productivity and digital interaction. The assistant boasts advanced natural language processing, allowing for seamless conversations and task management. Early users praise its intuitive interface and ability to learn user preferences over time. The company plans to integrate the assistant across its product ecosystem, offering a unified experience across devices.`,
  },
  {
    id: '2',
    imageUri:
      'https://images.pexels.com/photos/574071/pexels-photo-574071.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=750&w=1260',
    title: 'Breakthrough in Battery Technology Reduces Charging Time',
    body: `Scientists at a major research university have announced a new battery prototype that charges to 80% capacity in just 10 minutes. By leveraging a novel nano-structure in the electrode material, they’ve achieved both high energy density and rapid ion flow. Industry leaders say this could transform electric vehicles, smartphones, and wearable devices—cutting charging downtime dramatically. Several automotive brands have already signed licensing deals to incorporate this technology into next-gen models.`,
  },
  {
    id: '3',
    imageUri:
      'https://images.pexels.com/photos/267614/pexels-photo-267614.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=750&w=1260',
    title: 'Global Markets Surge After Central Bank Decision',
    body: `Stocks around the world rallied today after the International Central Bank announced a surprise interest-rate cut and signaled a more dovish monetary policy stance for the remainder of the year. Analysts say this move could spur economic growth but also warn of potential inflationary pressures in the coming quarters. Asian, European, and U.S. indices all closed up at least 2%, with tech and financial sectors leading the gains.`,
  },
];

export default function Index() {
  const [currentIndex, setCurrentIndex] = useState(0);
  const total = ARTICLES.length;
  const article = ARTICLES[currentIndex];

  // Advance to the next article (wrap around to index 0 at the end)
  const goToNext = () => {
    setCurrentIndex((prev) => (prev + 1) % total);
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* ─── HEADER ─── */}
      <View style={styles.header}>
        <View style={styles.spacer} />
        <Text style={styles.headerTitle}>News</Text>
        <TouchableOpacity style={styles.settingsButton}>
          <Feather name="settings" size={24} color="#101619" />
        </TouchableOpacity>
      </View>

      {/* ─── MAIN BODY: card (flex:1) + reactions ─── */}
      <View style={styles.mainBody}>
        {/* CARD: fills remaining space between header & reaction row */}
        <View style={styles.cardWrapper}>
          {/* HERO IMAGE: ~30% of card */}
          <View style={styles.imageContainer}>
            <ImageBackground
              source={{ uri: article.imageUri }}
              style={styles.heroImage}
              imageStyle={styles.heroImageRounded}
            />
          </View>

          {/* TEXT AREA: ~70% of card */}
          <View style={styles.articleContent}>
            <Text style={styles.articleTitle}>{article.title}</Text>
            <Text style={styles.articleBody}>{article.body}</Text>
          </View>
        </View>

        {/* REACTION BUTTONS: fixed height row under the card */}
        <View style={styles.reactionRow}>
          <TouchableOpacity
            onPress={goToNext}
            style={[styles.reactionButton, styles.mehButton]}
          >
            <Text style={styles.reactionText}>🤷 Meh</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={goToNext}
            style={[styles.reactionButton, styles.likeButton]}
          >
            <Text style={styles.reactionText}>👍 Like</Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  // ─── CONTAINER ───
  container: {
    flex: 1,
    backgroundColor: '#f3f5f6',
  },

  // ─── HEADER ───
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 56, // total header height (including status bar padding via SafeAreaView)
    paddingHorizontal: 16,
    backgroundColor: '#f3f5f6',
    borderBottomWidth: 1,
    borderBottomColor: '#e9eff1',
  },
  spacer: {
    width: 24, // keeps the “News” text centered (same width as settings icon)
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

  // ─── MAIN BODY: CARD + REACTIONS ───
  mainBody: {
    flex: 1, // fill everything between header & bottom tab bar
    justifyContent: 'space-between',
  },

  // CARD WRAPPER
  cardWrapper: {
    flex: 1, // span all remaining vertical space above the reactions
    marginHorizontal: 16,
    marginTop: 16,
    marginBottom: 8,
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

  // HERO IMAGE container (~30% of card’s height)
  imageContainer: {
    flex: 3,
  },
  heroImage: {
    width: '100%',
    height: '100%',
  },
  heroImageRounded: {
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
  },

  // ARTICLE TEXT container (~70% of card)
  articleContent: {
    flex: 7,
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

  // REACTIONS ROW (fixed-height under the card)
  reactionRow: {
    flexDirection: 'row',
    height: 50,
    marginHorizontal: 16,
    marginBottom: 8,
  },
  reactionButton: {
    flex: 1,
    marginHorizontal: 8,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mehButton: {
    backgroundColor: '#e9eff1',
  },
  likeButton: {
    backgroundColor: '#add6ea',
  },
  reactionText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#101619',
  }
});