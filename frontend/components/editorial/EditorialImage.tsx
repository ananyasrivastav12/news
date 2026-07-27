import { Image } from 'expo-image';
import React, { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { colors, radius, spacing } from '@/design/tokens';
import { SectionLabel, SourceText } from '@/components/editorial/Typography';

type EditorialImageProps = {
  imageUrl?: string;
  section: string;
  sourceName: string;
  aspectRatio?: number;
  topRadius?: boolean;
  accessibilityLabel?: string;
};

export function EditorialImage({
  imageUrl,
  section,
  sourceName,
  aspectRatio = 16 / 9,
  topRadius = true,
  accessibilityLabel,
}: EditorialImageProps) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const showImage = Boolean(imageUrl) && !failed;

  return (
    <View
      style={[
        styles.frame,
        { aspectRatio },
        topRadius && styles.topRadius,
      ]}
      accessible
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel ?? `${section} image from ${sourceName}`}
    >
      {showImage ? (
        <>
          {!loaded ? (
            <View style={styles.loadingLayer}>
              <ActivityIndicator color={colors.accent} />
            </View>
          ) : null}
          <Image
            source={{ uri: imageUrl }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            cachePolicy="memory-disk"
            onLoad={() => setLoaded(true)}
            onError={() => setFailed(true)}
          />
        </>
      ) : (
        <View style={styles.fallback}>
          <SectionLabel style={styles.monogram}>THE EDIT</SectionLabel>
          <View style={styles.rule} />
          <SectionLabel style={styles.fallbackSection}>{section}</SectionLabel>
          <SourceText style={styles.fallbackSource} numberOfLines={1}>
            {sourceName}
          </SourceText>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    width: '100%',
    overflow: 'hidden',
    backgroundColor: colors.imageFallback,
  },
  topRadius: {
    borderTopLeftRadius: radius.card,
    borderTopRightRadius: radius.card,
  },
  loadingLayer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceSecondary,
    zIndex: 1,
  },
  fallback: {
    flex: 1,
    justifyContent: 'center',
    padding: spacing.lg,
    gap: spacing.xs,
    backgroundColor: colors.imageFallback,
  },
  monogram: {
    color: colors.surfacePrimary,
    opacity: 0.9,
  },
  rule: {
    width: 64,
    height: 1,
    backgroundColor: colors.accent,
    marginVertical: spacing.xs,
  },
  fallbackSection: {
    color: colors.accentSoft,
  },
  fallbackSource: {
    color: colors.surfaceSecondary,
  },
});
