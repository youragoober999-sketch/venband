// The words behind /tos, /privacy, /privacy/connections and /policy/consumer-use.
//
// Each document is a list of numbered sections so the legal pages can show a
// table of contents and search every word. Blocks are plain strings
// (paragraphs), ['h', text] (a sub-heading) or ['ul', items] (a list). Inside a
// string, [label](/path) becomes a link.
//
// These are written for Venband. Keep them honest: when the app changes what
// it collects or how a feature works, change the words here in the same commit.

export type LegalBlock = string | ['h', string] | ['ul', string[]];
export interface LegalSection {
  id: string;
  title: string;
  body: LegalBlock[];
}
export interface LegalDoc {
  key: 'tos' | 'privacy' | 'connections' | 'consumer-use';
  path: string;
  title: string;
  short: string;
  effective: string;
  updated: string;
  intro: string[];
  sections: LegalSection[];
}

const EFFECTIVE = 'November 7, 2026';
const UPDATED = 'November 7, 2026';
const CONTACT = 'the issue tracker on our public source repository (linked at the bottom of every page)';

// ------------------------------------------------------------------- terms ---

const TERMS: LegalDoc = {
  key: 'tos',
  path: 'tos',
  title: 'Terms of Service',
  short: 'Terms',
  effective: EFFECTIVE,
  updated: UPDATED,
  intro: [
    'Welcome to Venband. These Terms of Service (the “Terms”) are the agreement between you and the people who run Venband (“Venband”, “we”, “us”). They cover the Venband website, the desktop and mobile apps, the developer API, bots and every other part of what we offer (together, the “Service”).',
    'Please read them. By creating an account, or by using the Service without one, you accept these Terms, our [Privacy Policy](/privacy), our [Consumer Use Policy](/policy/consumer-use) and our [Community Guidelines](/guidelines). If you do not accept them, do not use Venband.',
    'Short version: be at least 13, keep your account safe, only post what you have the right to post, don’t hurt people or the Service, and remember that Venband is a free, open-source project offered as it is.',
  ],
  sections: [
    {
      id: 'about',
      title: 'About Venband',
      body: [
        'Venband is a free place to talk: servers with text and voice channels, direct messages, group chats, calls, screen sharing, games you can play together in calls, and tools for communities. Messages and calls are end-to-end encrypted, which means they are locked on your device before they leave it.',
        'Venband is open source. Anyone can read the code that runs the Service. That openness is part of how we earn trust, and it does not give anyone extra rights to the Service, our name or our users’ content beyond what these Terms and the code’s license say.',
      ],
    },
    {
      id: 'agreement',
      title: 'Accepting these Terms',
      body: [
        'You accept these Terms when you tick the box at sign-up, when you sign in, or when you use the Service. If you use Venband on behalf of a group, club or organization, you confirm you are allowed to accept these Terms for it, and “you” includes that group.',
        'Some features come with extra rules (for example the developer platform or Voogle verification). Those rules are part of these Terms when you use those features. If they conflict with these Terms, the feature’s own rules win for that feature.',
      ],
    },
    {
      id: 'age',
      title: 'Who can use Venband',
      body: [
        'You must be at least 13 years old, or older if the law where you live sets a higher age for using services like this one without a parent’s consent. If you are under 18, or under the age of majority where you live, a parent or legal guardian must review and accept these Terms with you.',
        'You may not use Venband if you have been banned from it before, if you are barred from receiving services under the laws that apply to you, or if a court has told you not to.',
        'We ask for your date of birth at sign-up. Giving a false date of birth breaks these Terms and we may close the account.',
      ],
    },
    {
      id: 'account',
      title: 'Your account',
      body: [
        'Most of Venband needs an account. When you make one, give us accurate information and keep it up to date.',
        ['ul', [
          'You are responsible for everything that happens on your account. Keep your password, recovery code and devices safe, and turn on two-factor authentication.',
          'Because your messages are end-to-end encrypted, we cannot read them and we cannot recover them for you. If you lose your password and your recovery code, older encrypted messages may be lost for good.',
          'Don’t sell, rent, lend or give away your account or username. Don’t buy someone else’s.',
          'One person may keep up to five accounts signed in on the same device with the account switcher. Using several accounts to dodge a ban, fake support or manipulate votes, ranks or reports is not allowed.',
          'We may reclaim or change a username that impersonates someone, infringes a trademark, is offensive, or sits unused for a long time.',
          'Tell us right away if you think someone else got into your account.',
        ]],
      ],
    },
    {
      id: 'service',
      title: 'What we provide',
      body: [
        'We provide the Service for free and work to keep it fast, safe and available. We are always changing it: we may add, change or remove features, limits and designs, and we may stop offering parts of it. When a change takes something important away from you, we will try to tell you first.',
        'Servers are run by their owners and moderators, not by Venband. They set their own rules, roles, permissions and who may join. We are not responsible for how a server is run, though we do act on reports that a server breaks our rules.',
        'We do not promise the Service will always be available, uninterrupted or free of mistakes. Outages are posted on the [Status page](/status).',
      ],
    },
    {
      id: 'content',
      title: 'Your content',
      body: [
        '“Your content” is anything you add to Venband: messages, files, images, GIFs, voice, video, emoji, stickers, profile details, server names, bot replies and so on.',
        ['h', 'You own it'],
        'You keep every right you have in your content. We don’t claim ownership of it.',
        ['h', 'The permission you give us'],
        'To run the Service we have to store, copy, send and display your content (for example, to deliver an encrypted message to the people in a channel, or to show your avatar). You give Venband a worldwide, non-exclusive, royalty-free license to host, store, copy, transmit, display and adapt your content only as needed to operate, secure and improve the Service. For end-to-end encrypted content we only ever handle the encrypted form. This license ends when your content is deleted from the Service, except for copies we must keep by law or that other people have already saved or forwarded.',
        ['h', 'Your responsibility'],
        'Only post content you have the right to post. You are responsible for your content and for what happens because you posted it. Think about who can see a space before you post there: a public server or a large channel is not a private chat.',
        ['h', 'Feedback'],
        'If you send us ideas or suggestions, we may use them freely without owing you anything.',
      ],
    },
    {
      id: 'others-content',
      title: 'Other people’s content',
      body: [
        'Other people’s content belongs to them. Don’t copy, share or use it in ways they haven’t allowed or the law doesn’t allow. Content from other users does not reflect Venband’s views, and we do not check it before it is posted.',
        'You may run into content you find offensive or wrong. Use blocking, muting, filters and the report tools; leave spaces that aren’t for you.',
      ],
    },
    {
      id: 'gifs',
      title: 'GIFs, stickers, media and embeds',
      body: [
        'The GIF picker is powered by a third-party GIF search provider. GIFs come from that provider’s library and are subject to its terms; we don’t own them. Search terms you type are sent to the provider to find results.',
        'Link previews and embeds (for example a video or song link) may load content from the site you linked. You can turn link previews off in Settings → Privacy.',
        'Captioned images, edited GIFs and memes you make with Venband’s tools are your content. Make sure you have the right to use the original image.',
      ],
    },
    {
      id: 'safety',
      title: 'Safety and moderation',
      body: [
        'We want Venband to be a place where people feel safe. We provide tools to report messages, users and servers, and we review reports. Because messages are encrypted, a report includes the messages you choose to share with us so we can see them.',
        'We may remove content, limit features, put an account in read-only mode, suspend or ban accounts, or remove servers that break these Terms or the [Community Guidelines](/guidelines). We may also report illegal content to the authorities when the law requires it or when someone is in danger.',
        'If you or someone else is in immediate danger, contact local emergency services first.',
      ],
    },
    {
      id: 'rules',
      title: 'Things you must not do',
      body: [
        'Use Venband lawfully and the way it is meant to be used. In particular, you must not:',
        ['ul', [
          'harass, threaten, bully, stalk, dox or intimidate anyone, or encourage others to;',
          'share sexual content involving minors, sexual content without consent, or graphic violence meant to shock or glorify;',
          'promote terrorism, violent extremism, self-harm or hate against people for who they are;',
          'impersonate a person, brand or Venband staff, or mislead people about who you are;',
          'spam, run scams, phish for passwords, or spread malware;',
          'sell or trade accounts, servers, usernames, cosmetics or invites;',
          'break into accounts, servers or our systems, test our security without permission, or get around bans, blocks, rate limits or other protections;',
          'scrape or bulk-collect data about users without our written permission;',
          'overload, disrupt or damage the Service, or use it to attack anything else;',
          'use Venband to infringe anyone’s copyright, trademark, privacy or other rights;',
          'help or pay someone else to do any of the above.',
        ]],
        'The [Consumer Use Policy](/policy/consumer-use) explains these rules in more detail.',
      ],
    },
    {
      id: 'shop',
      title: 'Shop, cosmetics and special items',
      body: [
        'The Shop offers profile themes, profile effects, avatar decorations and nameplates. They are free. Items have no cash value, can’t be sold or transferred, and are licensed to your account for use inside Venband — you don’t own them.',
        'We may add, change, retire or rebalance items. Some items are reserved for specific roles (for example staff or owners) and can’t be unlocked otherwise. If we ever introduce paid items, separate terms will apply and we will show them before you pay.',
      ],
    },
    {
      id: 'games-calls',
      title: 'Games, calls and screen sharing',
      body: [
        'You can play built-in games with friends in calls, share your screen and stream. Only share what you have the right to share, and remember others in the call can record or screenshot what they see even though Venband doesn’t.',
        'Recording a call or other people’s voices may require their consent where you live. Ask first.',
      ],
    },
    {
      id: 'connections',
      title: 'Connected accounts',
      body: [
        'You can link accounts from other services (for example Steam, Spotify, Twitch, YouTube, TikTok, GitHub and Xbox). Linking is optional and you can unlink at any time. Those services are run by other companies with their own terms. What we receive and what we do with it is explained in [Connections & Privacy](/privacy/connections).',
      ],
    },
    {
      id: 'developers',
      title: 'Bots, apps and the developer platform',
      body: [
        'You can build bots and apps on Venband. If you do, you are responsible for them: follow these Terms, the [Consumer Use Policy](/policy/consumer-use) and any developer rules we publish, be honest about what your bot does, protect your bot tokens, and only collect the data your bot needs to work.',
        'Bots added to a server can read what server admins let them read. Venband does not control third-party bots and is not responsible for them. We may disable any bot or app that breaks the rules or puts users at risk.',
      ],
    },
    {
      id: 'software',
      title: 'Our software and open-source license',
      body: [
        'Venband’s source code is published under its open-source license, which you can read in our repository. That license governs what you may do with the code. It does not give you permission to use the Venband name, logo or branding, or to present a copy of the code as the official Venband service.',
        'When you download our desktop or mobile apps, we let you install and use them to access the Service. Apps may update themselves to fix problems and keep you secure.',
      ],
    },
    {
      id: 'brand',
      title: 'The Venband name and brand',
      body: [
        'The Venband name, logo, mascot artwork and the look of the official apps belong to the Venband project. You may refer to Venband by name to describe it truthfully. Don’t use our branding in a way that suggests we made, endorse or partner with something we don’t.',
      ],
    },
    {
      id: 'copyright',
      title: 'Copyright and intellectual property complaints',
      body: [
        'We respect creators’ rights. If you believe something on Venband infringes your copyright or trademark, send us a notice through ' + CONTACT + ' that includes: who you are and how to reach you; what work is being infringed; exactly where the infringing content is (a message or server link); a statement that you believe in good faith the use is not authorized; and a statement that your notice is accurate and that you are the rights holder or allowed to act for them.',
        'We remove content when a valid notice shows it infringes, and we close the accounts of people who infringe again and again. If your content was removed by mistake, you can send a counter-notice explaining why.',
      ],
    },
    {
      id: 'termination',
      title: 'Ending your use of Venband',
      body: [
        'You can stop using Venband whenever you want and delete your account from Settings → My Account. Deleting your account ends this agreement.',
        'We may suspend or close your account, or stop providing all or part of the Service to you, if you break these Terms, if the law requires it, if your account puts others or the Service at risk, or if your account has been inactive for more than two years. When it is reasonable and safe, we will tell you first and say why.',
        'Some parts of these Terms keep applying after your account ends, including the sections on content licenses already granted, disclaimers, limits on liability, indemnity and disputes.',
      ],
    },
    {
      id: 'appeals',
      title: 'Appeals',
      body: [
        'If we took action on your account or content and you think we got it wrong, you can appeal from the notice you receive or from the Appeals page in the app. A different person reviews it when possible. We will tell you the result.',
      ],
    },
    {
      id: 'disclaimers',
      title: 'The Service is provided “as is”',
      body: [
        'Venband is a free, community-built project. To the fullest extent the law allows, the Service is provided “as is” and “as available”, without warranties of any kind — whether express or implied — including warranties of merchantability, fitness for a particular purpose, title and non-infringement. We do not promise that the Service will meet your needs, be secure, or keep your content forever. Keep your own copies of anything important.',
        'Some places don’t allow these disclaimers. If you live in one of them, they apply only as far as the law there allows.',
      ],
    },
    {
      id: 'liability',
      title: 'Limits on our liability',
      body: [
        'To the fullest extent the law allows, Venband and its contributors are not liable for indirect, incidental, special, consequential or punitive damages, or for lost profits, data, goodwill or opportunities, arising from or related to the Service or these Terms, even if we were told they were possible.',
        'To the fullest extent the law allows, our total liability for any claim about the Service or these Terms is limited to 50 US dollars (or the same amount in your currency).',
        'Nothing in these Terms limits liability that the law says cannot be limited, such as liability for fraud or for death or personal injury caused by negligence.',
      ],
    },
    {
      id: 'indemnity',
      title: 'Indemnity',
      body: [
        'If someone brings a claim against Venband because of your content, your bot, your use of the Service, or your breaking these Terms or the law, you agree to cover the reasonable costs that result, including legal fees, to the extent the law allows. This does not apply to consumers where the law forbids it.',
      ],
    },
    {
      id: 'disputes',
      title: 'Disagreements and governing law',
      body: [
        'If you have a problem with Venband, contact us first through ' + CONTACT + ' — most things can be sorted out quickly that way.',
        'If we can’t resolve it, the dispute is governed by the laws of the place where you live and may be brought in the courts there, unless the law requires something different. Nothing in these Terms takes away rights you have as a consumer that can’t be waived.',
      ],
    },
    {
      id: 'changes',
      title: 'Changes to these Terms',
      body: [
        'We may update these Terms as Venband changes or as laws change. The date at the top shows the latest version. For important changes we will tell you in the app or by email before they take effect. If you keep using Venband after they take effect, you accept the new Terms. If you don’t agree, stop using the Service and delete your account.',
      ],
    },
    {
      id: 'general',
      title: 'General terms',
      body: [
        ['ul', [
          'These Terms, together with the policies they link to, are the whole agreement between you and Venband about the Service.',
          'If a court finds part of these Terms unenforceable, the rest still applies.',
          'If we don’t enforce a part of these Terms right away, we haven’t given up the right to enforce it later.',
          'You may not transfer your rights under these Terms to someone else. We may transfer ours if the project changes hands, and these Terms will continue to protect you.',
          'Section titles are for convenience only.',
        ]],
      ],
    },
    {
      id: 'contact',
      title: 'Contact us',
      body: ['Questions about these Terms? Reach us through ' + CONTACT + '. For safety issues use the in-app report tools so we can respond fastest.'],
    },
  ],
};

// ----------------------------------------------------------------- privacy ---

const PRIVACY: LegalDoc = {
  key: 'privacy',
  path: 'privacy',
  title: 'Privacy Policy',
  short: 'Privacy',
  effective: EFFECTIVE,
  updated: UPDATED,
  intro: [
    'Venband is built to know as little about you as it can. Your messages and calls are end-to-end encrypted: they are locked on your device, and we never have the keys to open them.',
    'This Privacy Policy explains what information we do handle, why, who else is involved, how long we keep it and what control you have. It applies to the Venband website, apps, API and bots (the “Service”). How linked accounts work is covered in more detail in [Connections & Privacy](/privacy/connections).',
  ],
  sections: [
    {
      id: 'summary',
      title: 'The short version',
      body: [
        ['ul', [
          'We can’t read your messages, files or calls.',
          'We collect what we need to run your account and keep Venband safe — not more.',
          'We don’t sell your data, we don’t show ads, and we don’t use tracking cookies.',
          'You can download or delete your data from Settings at any time.',
        ]],
      ],
    },
    {
      id: 'cannot-see',
      title: 'What we can’t see',
      body: [
        ['ul', [
          'The contents of your messages, files, images, voice and video calls in DMs, groups and server channels. They are encrypted on your device with keys we never receive.',
          'Your private keys. They are stored only after being encrypted with a key that comes from your password.',
          'Your password. Your device turns it into a login key; the password itself never reaches us.',
        ]],
      ],
    },
    {
      id: 'collect-account',
      title: 'Information you give us',
      body: [
        ['ul', [
          'Account details: email address, username, display name, date of birth (to check age) and password-derived login key.',
          'Profile details you choose to add: avatar, banner, bio, pronouns, status, profile colors, badges and cosmetics.',
          'Things you create that aren’t end-to-end encrypted by design: server names, icons, descriptions and discovery listings, public invite pages, bot profiles and status page posts.',
          'Reports, appeals and support requests, including any messages you choose to attach to them.',
        ]],
      ],
    },
    {
      id: 'collect-use',
      title: 'Information created when you use Venband',
      body: [
        ['ul', [
          'Membership and structure: the servers, channels and groups you are in, your roles, your friends and who you have blocked.',
          'Message metadata: who sent an encrypted message, where, when, and how big it is — not what it says.',
          'Presence: whether you are online, idle or in a call, and the activity you choose to show (for example a game or a song).',
          'Settings and preferences, such as your theme, notification choices and privacy toggles.',
          'Basic technical logs needed to operate and protect the Service, such as error reports and failed sign-in attempts.',
        ]],
      ],
    },
    {
      id: 'collect-device',
      title: 'Device and network information',
      body: [
        ['ul', [
          'At sign-up we store a one-way, salted fingerprint of your network address. It lets us limit how many accounts one network can create; it can’t be turned back into your IP address and is never shown to others.',
          'Your devices list shows each signed-in session. A rough city/country for a session is worked out only while you look at that list, and is not stored.',
          'If you complete Voogle verification, browser and device traits are stored only as one-way fingerprints.',
        ]],
      ],
    },
    {
      id: 'collect-connections',
      title: 'Linked accounts',
      body: [
        'If you link another service, we store the account ID, the display name and picture that service gives us, the permission level you approved and the date you linked it. We never receive your password for that service. Full details are in [Connections & Privacy](/privacy/connections).',
      ],
    },
    {
      id: 'use',
      title: 'How we use information',
      body: [
        ['ul', [
          'To create your account, sign you in and keep you signed in.',
          'To deliver encrypted messages, calls, files and notifications to the right people.',
          'To show your profile, presence and activity to the people you allow.',
          'To run features you turn on, such as link previews, translations, GIF search and connected-account activity.',
          'To keep Venband safe: fighting spam, fraud, abuse and attacks, enforcing our Terms and reviewing reports.',
          'To fix bugs and understand, in aggregate, which features are used so we can improve them.',
          'To follow the law and respond to valid legal requests.',
        ]],
        'We don’t use your information to build advertising profiles, and we don’t train AI models on your content.',
      ],
    },
    {
      id: 'legal-bases',
      title: 'Legal bases (EEA, UK and similar laws)',
      body: [
        'Where the law asks for a legal basis, we rely on: performing our contract with you (running your account and the Service); our legitimate interests in keeping Venband secure and working, balanced against your rights; your consent for optional features, which you can withdraw at any time; and legal obligations.',
      ],
    },
    {
      id: 'sharing',
      title: 'When information is shared',
      body: [
        ['ul', [
          'With other users, according to your settings: your profile, messages (which only they can decrypt), presence and activity.',
          'With server owners and moderators: your membership, roles and anything you post in their server, plus what you share in reports to them.',
          'With service providers who host Venband for us and only act on our instructions (see the next section).',
          'With a linked service, only what is needed to complete the link you asked for.',
          'For legal reasons: when we are legally required to, or when we believe in good faith it is needed to prevent serious harm. Because messages are encrypted, we can only provide what we actually have.',
          'If the project is taken over by someone else, your information moves with it under this policy, and we will tell you.',
        ]],
        'We never sell or rent your personal information.',
      ],
    },
    {
      id: 'providers',
      title: 'Companies that help run Venband',
      body: [
        ['ul', [
          'Supabase — database, sign-in and file storage.',
          'Vercel — website hosting and small server functions (for example link previews and completing account links).',
          'A GIF search provider — receives your GIF search terms.',
          'A translation service — receives the text you ask to translate (only when you use translation).',
          'The services you link in Connections — see [Connections & Privacy](/privacy/connections).',
        ]],
        'Each of them has its own privacy policy and is only allowed to use your information to provide their service to us.',
      ],
    },
    {
      id: 'cookies',
      title: 'Cookies and local storage',
      body: [
        'We don’t use advertising or tracking cookies. Venband uses your browser’s local storage to keep you signed in, remember your accounts on this device, store your settings and keep your encryption keys. Clearing it signs you out and may remove local data such as remembered keys.',
      ],
    },
    {
      id: 'retention',
      title: 'How long we keep information',
      body: [
        ['ul', [
          'Account and profile information: while your account exists.',
          'Encrypted messages and files: until you or the server deletes them, or the space they are in is deleted.',
          'Security logs: for a limited time, usually no longer than 90 days, unless needed for an investigation.',
          'Moderation records: as long as needed to keep the Service safe and to handle appeals.',
          'After you delete your account: personal information is deleted or anonymized within 30 days, except what we must keep by law or to prevent abuse (for example a record that an account was banned).',
        ]],
      ],
    },
    {
      id: 'security',
      title: 'How we protect information',
      body: [
        'End-to-end encryption for messages and calls, encrypted connections everywhere, strict database access rules that let each person see only what they should, signed links for files, two-factor authentication and secrets that stay on our servers. No system is perfect; if you find a security problem, please report it privately through ' + CONTACT + '.',
      ],
    },
    {
      id: 'children',
      title: 'Children',
      body: [
        'Venband is not for children under 13 (or the higher minimum age where they live). We don’t knowingly collect information from them. If you believe a child under that age has an account, tell us and we will delete it.',
      ],
    },
    {
      id: 'international',
      title: 'International transfers',
      body: [
        'Venband’s providers may store and process information in countries other than yours, including the United States. Where the law requires it, we rely on approved safeguards for these transfers.',
      ],
    },
    {
      id: 'rights',
      title: 'Your choices and rights',
      body: [
        ['ul', [
          'See and edit your information in Settings.',
          'Download a copy of your data from Settings.',
          'Delete your account from Settings → My Account.',
          'Unlink any connected account from Settings → Connections.',
          'Turn off link previews, embeds, activity sharing and other optional features in Settings → Privacy.',
          'Block people, leave servers and control who can message you or send friend requests.',
        ]],
        'Depending on where you live, you may also have the right to access, correct, delete or move your data, to object to or limit some uses, and to complain to a data protection authority. Contact us to use any right you can’t use from Settings. We may need to confirm it’s really you first.',
      ],
    },
    {
      id: 'california',
      title: 'Notice for US state privacy laws',
      body: [
        'We don’t sell personal information or share it for cross-context behavioral advertising, and we don’t use sensitive information to infer things about you. You can use the rights described above without being treated differently for doing so.',
      ],
    },
    {
      id: 'changes',
      title: 'Changes to this policy',
      body: [
        'When we change this policy we update the date at the top. If a change is significant, we will tell you in the app before it takes effect.',
      ],
    },
    {
      id: 'contact',
      title: 'Contact us',
      body: ['Questions or requests about privacy? Reach us through ' + CONTACT + '.'],
    },
  ],
};

// ------------------------------------------------------------- connections ---

const CONNECTIONS: LegalDoc = {
  key: 'connections',
  path: 'privacy/connections',
  title: 'Connections & Privacy',
  short: 'Connections',
  effective: EFFECTIVE,
  updated: UPDATED,
  intro: [
    'Connections let you link accounts you have on other services — like Steam, Spotify, Twitch, YouTube, TikTok, GitHub or Xbox — to your Venband account. This page explains exactly what happens when you connect one, what we receive, what we keep, who can see it and how to remove it.',
    'Connecting is always optional. Nothing about your Venband account depends on it.',
  ],
  sections: [
    {
      id: 'how',
      title: 'How connecting works',
      body: [
        'When you press Connect, Venband sends you to that service’s own sign-in page. You sign in there — never on Venband — and the service asks whether you want to let Venband see certain information. If you agree, the service sends you back to Venband with a one-time code or token, which we use to read the information you approved and save the link.',
        'We never see or store your password for the other service.',
      ],
    },
    {
      id: 'what-we-get',
      title: 'What we receive',
      body: [
        'Only what you approved on the service’s consent screen. For each service we ask for the smallest permission we can:',
        ['ul', [
          'Steam — your public Steam ID, profile name and avatar (Steam OpenID; no extra permissions).',
          'Spotify — your profile name and picture, and what you are currently playing (used for your activity and Listen Along).',
          'YouTube — your channel name, channel ID and picture (read-only).',
          'TikTok — your display name, avatar and an account ID that is specific to Venband.',
          'Twitch — your Twitch username, user ID and profile picture.',
          'GitHub — your GitHub username, user ID and avatar.',
          'Xbox — your gamertag and Xbox user ID, obtained through your Microsoft account.',
        ]],
      ],
    },
    {
      id: 'what-we-keep',
      title: 'What we keep',
      body: [
        'For each linked account we store: the service, the account ID, the display name and picture, the permission level you approved and when you linked it.',
        'Access tokens that let Venband keep reading something for you (for example Spotify’s “now playing”) are kept on your own device, in your browser’s storage, not in our database. Tokens used once to look up your profile are thrown away right after.',
        'Secret keys that identify Venband to these services are kept only on our servers, in protected environment settings. They are never put in the app, the website or our public source code.',
      ],
    },
    {
      id: 'visibility',
      title: 'Who can see your connections',
      body: [
        'Right now your linked accounts are visible only to you. Database rules stop anyone else — including other users and bots — from reading them.',
        'If you choose to show activity from a connection (for example the song you are listening to), that activity is shown on your profile and presence to the people who can see your status. You can turn activity sharing off at any time in Settings.',
      ],
    },
    {
      id: 'use',
      title: 'How we use connection data',
      body: [
        ['ul', [
          'To show the linked account in your Settings.',
          'To show activity you chose to share, such as what you are playing, streaming or listening to.',
          'To power features that need it, such as Listen Along.',
        ]],
        'We don’t sell connection data, use it for ads, post to other services on your behalf, or read your private messages on them.',
      ],
    },
    {
      id: 'other-services',
      title: 'The other service’s rules',
      body: [
        'The services you connect are run by other companies. Their terms and privacy policies apply to your accounts there, and they may record that you linked Venband. Review their permissions pages to see and manage what you have approved.',
      ],
    },
    {
      id: 'remove',
      title: 'Removing a connection',
      body: [
        'Go to Settings → Connections and choose Remove. We delete the stored link right away. To also cut off Venband’s access on the other service’s side, revoke it in that service’s security or connected-apps settings (for example Spotify’s “Manage apps”, Google’s “Third-party connections”, GitHub’s “Authorized GitHub Apps”, Microsoft’s “App permissions”, Twitch’s “Connections”).',
        'Deleting your Venband account removes all of your connections.',
      ],
    },
    {
      id: 'accuracy',
      title: 'Linking accounts honestly',
      body: [
        'Only connect accounts that are yours. Linking someone else’s account, or using a connection to pretend to be another person or brand, breaks our [Terms](/tos) and [Consumer Use Policy](/policy/consumer-use).',
      ],
    },
    {
      id: 'security',
      title: 'Security of connections',
      body: [
        'Every link uses the service’s official sign-in flow over an encrypted connection. Where the service supports it we use extra protections (such as PKCE) so a link code can’t be reused by anyone else. Codes are only accepted at Venband’s registered return addresses.',
      ],
    },
    {
      id: 'kids',
      title: 'Younger users',
      body: [
        'If you are under 18, check with a parent or guardian before linking accounts, and follow the age rules of the service you are connecting.',
      ],
    },
    {
      id: 'changes',
      title: 'Changes',
      body: [
        'If we add a new service or start using connection data in a new way, we will update this page first, and ask for new permission where needed.',
      ],
    },
    {
      id: 'contact',
      title: 'Questions',
      body: ['Reach us through ' + CONTACT + '. See also our full [Privacy Policy](/privacy).'],
    },
  ],
};

// ------------------------------------------------------------ consumer use ---

const CONSUMER: LegalDoc = {
  key: 'consumer-use',
  path: 'policy/consumer-use',
  title: 'Consumer Use Policy',
  short: 'Consumer Use',
  effective: EFFECTIVE,
  updated: UPDATED,
  intro: [
    'This policy explains what every person who signs up for Venband agrees to follow. When you create an account and accept our [Terms of Service](/tos) and [Privacy Policy](/privacy), you also accept this policy. It turns the rules in our Terms into plain, practical commitments.',
  ],
  sections: [
    {
      id: 'when',
      title: 'When this policy applies',
      body: [
        'Everywhere on Venband: servers, DMs, group chats, calls, streams, profiles, bots, the Shop, discovery listings and our public pages. It applies whether you are a member, a moderator, a server owner or a developer.',
      ],
    },
    {
      id: 'signup',
      title: 'What you confirm when you sign up',
      body: [
        ['ul', [
          'You are at least 13, or the higher minimum age where you live, and the date of birth you entered is true.',
          'If you are a minor, a parent or guardian has agreed to the Terms with you.',
          'The email address you use is yours and you can receive mail there.',
          'You haven’t been banned from Venband before.',
          'You have read and accept the Terms of Service, the Privacy Policy, this Consumer Use Policy and the Community Guidelines.',
        ]],
      ],
    },
    {
      id: 'account-care',
      title: 'Looking after your account',
      body: [
        ['ul', [
          'Use a strong password you don’t use anywhere else, save your recovery code somewhere safe and turn on two-factor authentication.',
          'Never share your password, recovery code or sign-in links — Venband staff will never ask for them.',
          'Sign out of devices you don’t use and remove accounts you don’t need from the account switcher.',
          'You are responsible for what is done with your account.',
        ]],
      ],
    },
    {
      id: 'respect',
      title: 'Respect other people',
      body: [
        ['ul', [
          'No harassment, threats, bullying, hate or targeted insults.',
          'Don’t share someone’s private information (doxxing), or images of them without consent.',
          'Respect blocks and “no”. Don’t keep contacting someone who has asked you to stop, and don’t make new accounts to reach them.',
          'Don’t pretend to be someone else, including Venband staff, moderators or bots.',
        ]],
      ],
    },
    {
      id: 'safety',
      title: 'Keep it safe',
      body: [
        ['ul', [
          'Nothing that sexualizes minors — ever. We report it to the authorities.',
          'No sexual content involving anyone without consent; adult content only where it is allowed and correctly marked.',
          'No content that promotes self-harm, terrorism, violent extremism or real-world violence.',
          'No selling or promoting illegal goods, weapons or drugs.',
        ]],
      ],
    },
    {
      id: 'honesty',
      title: 'Be honest',
      body: [
        ['ul', [
          'No scams, phishing, fake giveaways or “free cosmetics” links.',
          'No spam, mass DMs, invite flooding or fake engagement.',
          'Don’t spread content made to mislead people about elections, health emergencies or public safety.',
          'Don’t buy, sell or trade accounts, servers, usernames, invites or Shop items.',
        ]],
      ],
    },
    {
      id: 'ip',
      title: 'Respect creators',
      body: [
        'Only upload, stream or share content you have the right to. Captioning or remixing images and GIFs is fine for personal fun, but don’t pass off other people’s work as yours or use it for profit without permission.',
      ],
    },
    {
      id: 'platform',
      title: 'Don’t abuse the platform',
      body: [
        ['ul', [
          'No hacking, cracking, or testing our security without written permission — report vulnerabilities privately instead.',
          'No self-bots, scrapers or automation on a user account. Use the official bot platform.',
          'No getting around bans, rate limits, verification or other protections.',
          'No overloading or disrupting the Service, voice calls or other users’ devices.',
        ]],
      ],
    },
    {
      id: 'servers',
      title: 'If you run a server',
      body: [
        ['ul', [
          'Set clear rules that are at least as strict as ours, and enforce them.',
          'Give moderator powers only to people you trust, and require two-factor authentication for them where possible.',
          'Mark age-restricted channels correctly.',
          'Don’t use your server to organize anything that breaks this policy.',
        ]],
      ],
    },
    {
      id: 'bots',
      title: 'If you build bots or apps',
      body: [
        ['ul', [
          'Say clearly what your bot does and what data it uses.',
          'Collect only what you need, protect it, and delete it when asked.',
          'Keep your bot token secret. Rotate it immediately if it leaks.',
          'Don’t use bots to spam, scrape users or get around our rules.',
        ]],
      ],
    },
    {
      id: 'connections',
      title: 'Connected accounts',
      body: [
        'Only connect accounts that belong to you, and follow the other service’s rules too. See [Connections & Privacy](/privacy/connections).',
      ],
    },
    {
      id: 'minors',
      title: 'Extra care for younger users',
      body: [
        'Adults must not seek out minors for romantic or sexual contact, ask them for images or personal details, or encourage them to move to less safe places. If you see this happening, report it right away.',
      ],
    },
    {
      id: 'reporting',
      title: 'Reporting problems',
      body: [
        'Use Report on any message, profile or server. Reports are confidential — the person you report isn’t told who reported them. Making false reports on purpose is itself against this policy.',
      ],
    },
    {
      id: 'enforcement',
      title: 'What happens if the rules are broken',
      body: [
        'Depending on how serious it is and whether it has happened before, we may: warn you, remove content, limit features, put your account in read-only mode for a while, suspend it, or ban it permanently. Serious harm can lead to an immediate ban and a report to the authorities. You can appeal decisions from the Appeals page.',
      ],
    },
    {
      id: 'changes',
      title: 'Changes to this policy',
      body: ['We may update this policy as Venband grows. The date at the top shows the current version; important changes are announced in the app.'],
    },
  ],
};

export const LEGAL_DOCS: LegalDoc[] = [TERMS, PRIVACY, CONNECTIONS, CONSUMER];
export const legalDoc = (key: LegalDoc['key']) => LEGAL_DOCS.find((d) => d.key === key)!;

/** Plain text of a block, for search. */
export const blockText = (b: LegalBlock): string => (typeof b === 'string' ? b : b[0] === 'h' ? b[1] : b[1].join('\n')).replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
