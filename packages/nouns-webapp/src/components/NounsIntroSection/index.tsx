import { Trans } from '@lingui/react/macro';
import { Col } from 'react-bootstrap';

import ActiveProposalsWidget from '@/components/ActiveProposalsWidget';
import Section from '@/layout/Section';

import FloatingAccessories from './FloatingAccessories';
import classes from './NounsIntroSection.module.css';

const NounsIntroSection = () => {
  return (
    <div style={{ position: 'relative' }}>
      {/* Floating Nouns accessories behind all content */}
      <FloatingAccessories />

      <div className={classes.heroTitle} style={{ position: 'relative', zIndex: 1 }}>
        <h1>
          <Trans>One Noun, Every Day, Forever.</Trans>
        </h1>
      </div>
      <Section
        fullWidth={false}
        className={classes.videoSection}
        style={{ position: 'relative', zIndex: 1 }}
      >
        <Col lg={6}>
          <div className={classes.textWrapper}>
            <p>
              <Trans>
                Behold, an infinite work of art! Nouns is a community-owned brand that makes a
                positive impact by funding ideas and fostering collaboration. From collectors and
                technologists, to non-profits and brands, Nouns is for everyone.
              </Trans>
            </p>
            <ActiveProposalsWidget />
          </div>
        </Col>
        <Col lg={6} className={classes.gifContainer}>
          <img src="/untitled2026.gif" alt="Nouns 2026 artwork" className={classes.gifImage} />
        </Col>
      </Section>

      <div className={classes.heroTitle} style={{ position: 'relative', zIndex: 1 }}>
        <h1>
          <Trans>Build With Nouns. Get Funded.</Trans>
        </h1>
      </div>
      <Section
        fullWidth={false}
        className={classes.videoSection}
        style={{ position: 'relative', zIndex: 1 }}
      >
        <Col lg={6} className={`${classes.gifContainer} order-lg-1 order-2`}>
          <img
            src="https://scontent-iad4-1.choicecdn.com/-/rs:fill:2000:3046/g:ce/f:webp/aHR0cHM6Ly9tYWdpYy5kZWNlbnRyYWxpemVkLWNvbnRlbnQuY29tL2lwZnMvYmFmeWJlaWhwc2s0amNuazR1NWtnYnpqNHZudDZ0b3pnZnRmd3d3dHo3c29ja3R1bHJ3aDZiYW5ibnE"
            alt="Artwork"
            className={classes.gifImage}
          />
        </Col>

        <Col lg={6} className={`order-lg-2 order-1`}>
          <div className={`${classes.textWrapper} ${classes.youtubeSectionText}`}>
            <p>
              there&apos;s a way for everyone to get involved with Nouns. From whimsical endeavors
              like naming a frog, to legal defence funds supporting Ethereum and privacy, or even
              crypto infrastructure like{' '}
              <a href="/probe">probe.wtf</a>
              . Nouns funds projects of all sizes and domains, the founders have mainly checked out
              and the community is torn between Book Value and{' '}
              <a
                href="https://memevalue.pinit.eth.limo"
                target="_blank"
                rel="noopener noreferrer"
              >
                Meme Value
              </a>
              .
            </p>
          </div>
        </Col>
      </Section>
      <Section
        fullWidth={false}
        className={classes.videoSection}
        style={{ position: 'relative', zIndex: 1 }}
      >
        <Col lg={12}>
          <div className={classes.textWrapper}>
            <h1 className={classes.globalHeader}>
              <Trans>Nouns is a global community.</Trans>
            </h1>
          </div>
        </Col>
      </Section>
    </div>
  );
};

export default NounsIntroSection;
