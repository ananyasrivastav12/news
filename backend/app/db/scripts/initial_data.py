# In app/db/scripts/initial_data.py

import sys
from pathlib import Path

# Add project root to the Python path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

import logging

from app.db.model import Interest, SourceType
from app.db.session import SessionLocal

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Define the initial interests based on News API categories and your suggestions
NEWS_INTERESTS = [
    "Business",
    "Entertainment",
    "General",
    "Health",
    "Science",
    "Sports",
    "Technology",
    "Politics",  # As requested
    "Crime",  # As requested
    "World",  # As requested
]

WIKI_INTERESTS = [
    "History",
    "Geography",
    "Finance",  # Can overlap with news, but context is different
    "Art",
    "Philosophy",
    "Trending",  # A special category for dynamically changing topics
]


def populate_interests():
    db = SessionLocal()
    try:
        # Populate News Interests
        for interest_name in NEWS_INTERESTS:
            # Check if the interest already exists
            exists = (
                db.query(Interest)
                .filter_by(name=interest_name, source_type=SourceType.NEWS)
                .first()
            )
            if not exists:
                interest = Interest(name=interest_name, source_type=SourceType.NEWS)
                db.add(interest)
                logger.info(f"Added News interest: {interest_name}")

        # Populate Wiki Interests
        for interest_name in WIKI_INTERESTS:
            exists = (
                db.query(Interest)
                .filter_by(name=interest_name, source_type=SourceType.WIKI)
                .first()
            )
            if not exists:
                interest = Interest(name=interest_name, source_type=SourceType.WIKI)
                db.add(interest)
                logger.info(f"Added Wiki interest: {interest_name}")

        db.commit()
        logger.info("Successfully populated interests.")

    finally:
        db.close()


if __name__ == "__main__":
    logger.info("Starting to populate initial data...")
    populate_interests()
    logger.info("Finished populating initial data.")
