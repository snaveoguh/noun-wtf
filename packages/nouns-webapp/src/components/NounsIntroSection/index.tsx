import { Trans } from '@lingui/react/macro';
import { Col } from 'react-bootstrap';

import Section from '@/layout/Section';

import classes from './NounsIntroSection.module.css';

const NounsIntroSection = () => {
  return (
    <>
      <Section fullWidth={false} className={classes.videoSection}>
        <Col lg={6}>
          <div className={classes.textWrapper}>
            <h1>
              <Trans>One Noun, Every Day, Forever.</Trans>
            </h1>
            <p>
              <Trans>
                Behold, an infinite work of art! Nouns is a community-owned brand that makes a
                positive impact by funding ideas and fostering collaboration. From collectors and
                technologists, to non-profits and brands, Nouns is for everyone.
              </Trans>
            </p>
            <div style={{ marginTop: '12px' }}>
              <button
                onClick={() => window.dispatchEvent(new CustomEvent('open-dream-window'))}
                style={{
                  background: '#ffef2e',
                  border: '2px solid #000',
                  boxShadow: '4px 3px 0 0 #000',
                  color: '#000',
                  fontWeight: 700,
                  fontSize: '0.85rem',
                  padding: '3px 14px',
                  cursor: 'pointer',
                  fontFamily: "'Comic Sans MS', 'Comic Sans', cursive",
                  textTransform: 'uppercase',
                  letterSpacing: '0.03em',
                  transition: 'box-shadow 0.1s ease, transform 0.1s ease',
                }}
                onMouseDown={e => {
                  const btn = e.currentTarget;
                  btn.style.boxShadow = 'none';
                  btn.style.transform = 'translate(4px, 3px)';
                }}
                onMouseUp={e => {
                  const btn = e.currentTarget;
                  btn.style.boxShadow = '4px 3px 0 0 #000';
                  btn.style.transform = 'translate(0, 0)';
                }}
                onMouseLeave={e => {
                  const btn = e.currentTarget;
                  btn.style.boxShadow = '4px 3px 0 0 #000';
                  btn.style.transform = 'translate(0, 0)';
                }}
              >
                ✨ dream a lil dream
              </button>
            </div>
          </div>
        </Col>
        <Col lg={6} className={classes.gifContainer}>
          <img
            src="https://scontent-iad4-1.choicecdn.com/-/rs:fill:2000:3046/g:ce/f:webp/aHR0cHM6Ly9tYWdpYy5kZWNlbnRyYWxpemVkLWNvbnRlbnQuY29tL2lwZnMvYmFmeWJlaWVjN3A0a3RrbXl6cm1kZGR4cGhhZTQyNzdyZ3o3amJ6ZDUzZzRnaGM0cmtsZHR5d3RscWk"
            alt="Artwork"
            className={classes.gifImage}
          />
        </Col>
      </Section>
      <Section fullWidth={false} className={classes.videoSection}>
        <Col lg={6} className={`${classes.gifContainer} order-lg-1 order-2`}>
          <img
            src="https://scontent-iad4-1.choicecdn.com/-/rs:fill:2000:3046/g:ce/f:webp/aHR0cHM6Ly9tYWdpYy5kZWNlbnRyYWxpemVkLWNvbnRlbnQuY29tL2lwZnMvYmFmeWJlaWhwc2s0amNuazR1NWtnYnpqNHZudDZ0b3pnZnRmd3d3dHo3c29ja3R1bHJ3aDZiYW5ibnE"
            alt="Artwork"
            className={classes.gifImage}
          />
        </Col>

        <Col lg={6} className={`order-lg-2 order-1`}>
          <div className={`${classes.textWrapper} ${classes.youtubeSectionText}`}>
            <h1>
              <Trans>Build With Nouns. Get Funded.</Trans>
            </h1>
            <p>
              <Trans>
                There&apos;s a way for everyone to get involved with Nouns. From whimsical endeavors
                like naming a frog, to ambitious projects like constructing a giant float for the
                Rose Parade, or even crypto infrastructure like Prop House. Nouns funds projects of
                all sizes and domains.
              </Trans>
            </p>
          </div>
        </Col>
      </Section>
      <Section fullWidth={false} className={classes.videoSection}>
        <Col lg={12}>
          <div className={classes.textWrapper}>
            <h1>
              <Trans>Nouns is a global community.</Trans>
            </h1>
            <p>
              <Trans>
                From a school in Uganda to a coffee shop in LA, from a crypto hub in Sao Paulo to a
                deli in Melbourne, Nouns lives wherever creative people bring ideas to life.
              </Trans>
            </p>
          </div>
        </Col>
        <Col lg={12} className={classes.gifContainerFull}>
          <img
            src="https://scontent-iad4-1.choicecdn.com/-/rs:fill:2000:3046/g:ce/f:webp/aHR0cHM6Ly9tYWdpYy5kZWNlbnRyYWxpemVkLWNvbnRlbnQuY29tL2lwZnMvYmFmeWJlaWVrdnU3YnZkdmtoYjQ2cmhpcXdpNGFla2l2MmVxZWk3NHRxaHdhdHlmN3dlNnY0M2FzbHE"
            alt="Artwork"
            className={classes.gifImageFull}
          />
        </Col>
      </Section>
    </>
  );
};

export default NounsIntroSection;
