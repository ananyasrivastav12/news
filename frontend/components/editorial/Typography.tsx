import React from 'react';
import { Text, TextProps } from 'react-native';

import { colors, typeScale } from '@/design/tokens';

type EditorialTextProps = TextProps & {
  children: React.ReactNode;
};

function EditorialText({ style, ...props }: EditorialTextProps & { variant: keyof typeof typeScale }) {
  const { variant, ...rest } = props;
  return (
    <Text
      {...rest}
      style={[{ color: colors.inkPrimary }, typeScale[variant], style]}
    />
  );
}

export function Masthead(props: EditorialTextProps) {
  return <EditorialText {...props} variant="masthead" />;
}

export function EditionTitle(props: EditorialTextProps) {
  return <EditorialText {...props} variant="editionTitle" numberOfLines={1} />;
}

export function ScreenTitle(props: EditorialTextProps) {
  return <EditorialText {...props} variant="screenTitle" />;
}

export function ArticleHeadline(props: EditorialTextProps) {
  return <EditorialText {...props} variant="articleHeadline" />;
}

export function SavedHeadline(props: EditorialTextProps) {
  return <EditorialText {...props} variant="savedHeadline" numberOfLines={2} />;
}

export function Summary(props: EditorialTextProps) {
  return <EditorialText {...props} variant="summary" />;
}

export function WhyItMatters(props: EditorialTextProps) {
  return <EditorialText {...props} variant="whyItMatters" />;
}

export function SectionLabel(props: EditorialTextProps) {
  return <EditorialText {...props} variant="sectionLabel" />;
}

export function SourceText(props: EditorialTextProps) {
  return <EditorialText {...props} variant="source" />;
}

export function Metadata(props: EditorialTextProps) {
  return <EditorialText {...props} variant="metadata" />;
}

export function ButtonText(props: EditorialTextProps) {
  return <EditorialText {...props} variant="button" />;
}
