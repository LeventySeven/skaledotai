-- Import internal leads from influencer campaign sheet
-- Only X (Twitter) creators, engagement group deliverable ignored
-- price in cents, notes: good = locked/approved, bad = rejected/backed out
-- deliverables: quote, like, comment, thread, repost
-- "full" = {"quote","comment","like","thread"} (all 4 core deliverables)

INSERT INTO internal_leads (user_id, name, handle, platform, deliverables, url, email, price, notes)
VALUES
  -- GOOD (Locked)
  ('Qvq4HaNzp4L4MppTyAmTxW8CH2Z0OmW0', 'Chase Passive Income', 'chasedownleads', 'twitter', '{"quote","like","comment"}', 'https://x.com/chasedownleads', 'charlie@solowriters.com', 25000, 'good'),
  ('Qvq4HaNzp4L4MppTyAmTxW8CH2Z0OmW0', 'Mikael (Festive)', 'BacardiCapital', 'twitter', '{"quote"}', 'https://x.com/BacardiCapital', 'Bacardicapital@gmail.com', 30000, 'good'),
  ('Qvq4HaNzp4L4MppTyAmTxW8CH2Z0OmW0', 'Drapz', 'DrapzDZN', 'twitter', '{"full"}', 'https://x.com/DrapzDZN', 'drapzdzn@gmail.com', 30000, 'good'),
  ('Qvq4HaNzp4L4MppTyAmTxW8CH2Z0OmW0', 'Darius Dan', 'dariusdan', 'twitter', '{"full"}', 'https://x.com/dariusdan', 'hi@dariusdan.com', 30000, 'good'),
  ('Qvq4HaNzp4L4MppTyAmTxW8CH2Z0OmW0', 'The P God', 'the_p_god', 'twitter', '{"quote"}', 'https://x.com/the_p_god', 'Hparsonsh@gmail.com', 35000, 'good'),
  ('Qvq4HaNzp4L4MppTyAmTxW8CH2Z0OmW0', 'Faraz', 'farazcreatives', 'twitter', '{"quote","thread"}', 'https://x.com/farazcreatives', 'farazdsgn@gmail.com', 35000, 'good'),
  ('Qvq4HaNzp4L4MppTyAmTxW8CH2Z0OmW0', 'Alpha', 'alphafox', 'twitter', '{"quote","comment"}', 'https://x.com/alphafox', 'alphafox78@gmail.com', 50000, 'good'),
  ('Qvq4HaNzp4L4MppTyAmTxW8CH2Z0OmW0', 'UxUi Tega', 'Tegadesigns', 'twitter', '{"quote"}', 'https://x.com/Tegadesigns', 'tegapeace88@gmail.com', 75000, 'good'),
  ('Qvq4HaNzp4L4MppTyAmTxW8CH2Z0OmW0', 'Patel', 'parikpatelcfa', 'twitter', '{"repost","comment"}', 'https://x.com/parikpatelcfa', 'parikpatelcfa@gmail.com', 80000, 'good'),
  ('Qvq4HaNzp4L4MppTyAmTxW8CH2Z0OmW0', 'Not Jerome Powell', 'alifarhat79', 'twitter', '{"quote","comment"}', 'https://x.com/alifarhat79', 'Alifarhat50@hotmail.com', 100000, 'good'),
  ('Qvq4HaNzp4L4MppTyAmTxW8CH2Z0OmW0', 'TikTok Investors', 'tiktokinvestors', 'twitter', '{"quote","comment"}', 'https://x.com/tiktokinvestors', 'tiktokinvestors@gmail.com', 100000, 'good'),
  ('Qvq4HaNzp4L4MppTyAmTxW8CH2Z0OmW0', 'No Context Humans', 'NoContextHumans', 'twitter', '{"quote","comment"}', 'https://x.com/NoContextHumans', 'Gpsocialmedia98@gmail.com', 125000, 'good'),
  ('Qvq4HaNzp4L4MppTyAmTxW8CH2Z0OmW0', 'Isaac Zara', 'isaaczara_', 'twitter', '{"full"}', 'https://x.com/isaaczara_', 'isaaczara.s@gmail.com', 130000, 'good'),
  ('Qvq4HaNzp4L4MppTyAmTxW8CH2Z0OmW0', 'The Rabbit Hole', 'therabbithole', 'twitter', '{"quote","like","comment"}', 'https://x.com/therabbithole', 'darabbithole1@gmail.com', 150000, 'good'),
  ('Qvq4HaNzp4L4MppTyAmTxW8CH2Z0OmW0', 'Dylan Calluy', 'dylancalluy', 'twitter', '{"full"}', 'https://x.com/dylancalluy', 'hello@dylancalluy.com', 150000, 'good'),
  ('Qvq4HaNzp4L4MppTyAmTxW8CH2Z0OmW0', 'Abraham John', 'Abmankendrick', 'twitter', '{"full"}', 'https://x.com/Abmankendrick', 'abrahamjo333@gmail.com', 175000, 'good'),
  ('Qvq4HaNzp4L4MppTyAmTxW8CH2Z0OmW0', 'Tiffany Fong', 'TiffanyFong', 'twitter', '{"quote","like","comment"}', 'https://x.com/TiffanyFong', 'tiffanyxfong@gmail.com', 200000, 'good'),
  ('Qvq4HaNzp4L4MppTyAmTxW8CH2Z0OmW0', 'History In Memes', 'historyinmemes', 'twitter', '{"quote","like","comment"}', 'https://x.com/historyinmemes', 'Evan@historyinmemes.com', 250000, 'good'),
  ('Qvq4HaNzp4L4MppTyAmTxW8CH2Z0OmW0', 'Internet Hall Of Fame', 'InternetH0F', 'twitter', '{"quote","comment"}', 'https://x.com/InternetH0F', 'j@crazed.net', 250000, 'good'),
  ('Qvq4HaNzp4L4MppTyAmTxW8CH2Z0OmW0', 'Interesting AF', 'interesting_aIl', 'twitter', '{"quote","comment"}', 'https://x.com/interesting_aIl', 'j@crazed.net', 250000, 'good'),
  ('Qvq4HaNzp4L4MppTyAmTxW8CH2Z0OmW0', 'Brett', 'brettfromdj', 'twitter', '{"thread"}', 'https://x.com/brettfromdj', 'Hello@designjoy.co', 250000, 'good'),
  ('Qvq4HaNzp4L4MppTyAmTxW8CH2Z0OmW0', 'Mike Mints', 'creativemints', 'twitter', '{"quote"}', 'https://x.com/creativemints', 'mike@creativemints.com', 100000, 'good'),
  ('Qvq4HaNzp4L4MppTyAmTxW8CH2Z0OmW0', '(Future Stacked) AI Highlights', 'aihighlight', 'twitter', '{"full"}', 'https://x.com/aihighlight', 'hello@futurestacked.com', 436200, 'good'),
  ('Qvq4HaNzp4L4MppTyAmTxW8CH2Z0OmW0', '(Future Stacked) AI Colony', 'theaicolony', 'twitter', '{"full"}', 'https://x.com/theaicolony', 'hello@futurestacked.com', NULL, 'good'),
  ('Qvq4HaNzp4L4MppTyAmTxW8CH2Z0OmW0', '(Future Stacked) AI Frontliner', 'aifrontliner', 'twitter', '{"full"}', 'https://x.com/aifrontliner', 'hello@futurestacked.com', NULL, 'good'),
  ('Qvq4HaNzp4L4MppTyAmTxW8CH2Z0OmW0', '(Future Stacked) Future Stacked', 'FutureStacked', 'twitter', '{"full"}', 'https://x.com/FutureStacked', 'hello@futurestacked.com', NULL, 'good'),
  ('Qvq4HaNzp4L4MppTyAmTxW8CH2Z0OmW0', 'Amira Zairi', 'azed_ai', 'twitter', '{"full"}', 'https://x.com/azed_ai', 'zairi.amiraa@gmail.com', 30000, 'good'),
  ('Qvq4HaNzp4L4MppTyAmTxW8CH2Z0OmW0', 'Alex Prompter', 'alex_prompter', 'twitter', '{"full"}', 'https://x.com/alex_prompter', 'info@godofprompt.ai', 120000, 'good'),
  ('Qvq4HaNzp4L4MppTyAmTxW8CH2Z0OmW0', 'God of Prompt', 'godofprompt', 'twitter', '{"full"}', 'https://x.com/godofprompt', 'info@godofprompt.ai', NULL, 'good'),
  ('Qvq4HaNzp4L4MppTyAmTxW8CH2Z0OmW0', 'Jonathan Bach', 'VibeMarketer_', 'twitter', '{"full"}', 'https://x.com/VibeMarketer_', 'Jonathan@riverstreetmedia.no', 125000, 'good'),
  ('Qvq4HaNzp4L4MppTyAmTxW8CH2Z0OmW0', 'Charly Wargnier', 'DataChaz', 'twitter', '{"full"}', 'https://x.com/DataChaz', 'charly@charlywargnier.com', 88700, 'good'),
  ('Qvq4HaNzp4L4MppTyAmTxW8CH2Z0OmW0', 'Jacob Rodri', 'jacobrodri_', 'twitter', '{"full"}', 'https://x.com/jacobrodri_', 'hi@jacobrodri.pro', 100000, 'good'),
  ('Qvq4HaNzp4L4MppTyAmTxW8CH2Z0OmW0', 'Edward Frank Morris', 'ThatsEFM', 'twitter', '{"full"}', 'https://x.com/ThatsEFM', 'Edward@Enigmatica.co.uk', 99700, 'good'),
  ('Qvq4HaNzp4L4MppTyAmTxW8CH2Z0OmW0', 'Mav', 'wallstreetmav', 'twitter', '{"quote"}', 'https://x.com/wallstreetmav', 'James@WallStreetMav.com', 100000, 'good'),
  ('Qvq4HaNzp4L4MppTyAmTxW8CH2Z0OmW0', 'The Kobeissi Letter', 'KobeissiLetter', 'twitter', '{"quote"}', 'https://x.com/KobeissiLetter', 'Adam@thekobeissiletter.com', 500000, 'good'),
  ('Qvq4HaNzp4L4MppTyAmTxW8CH2Z0OmW0', 'Yahyavision', 'yahyavision', 'twitter', '{"full"}', 'https://x.com/yahyavision', 'yahyadesign23@gmail.com', 40000, 'good'),
  -- GOOD (Approved by Shown)
  ('Qvq4HaNzp4L4MppTyAmTxW8CH2Z0OmW0', 'Dr. Roman Yampolskiy', 'romanyam', 'twitter', '{"full"}', 'https://x.com/romanyam', 'Roman.Yampolskiy@louisville.edu', 100000, 'good'),
  ('Qvq4HaNzp4L4MppTyAmTxW8CH2Z0OmW0', 'Vas Moza', 'vasuman', 'twitter', '{"full"}', 'https://x.com/vasuman', 'vas@varickagents.com', 150000, 'good'),
  ('Qvq4HaNzp4L4MppTyAmTxW8CH2Z0OmW0', 'Caiden', 'pipelineabuser', 'twitter', '{"quote"}', 'https://x.com/pipelineabuser', 'caiden@deliveron.org', 150000, 'good'),
  ('Qvq4HaNzp4L4MppTyAmTxW8CH2Z0OmW0', 'Henrick Johansson', 'compliantvc', 'twitter', '{"full"}', 'https://x.com/compliantvc', 'charlie@solowriters.com', 20000, 'good'),
  -- BAD (Backed Out)
  ('Qvq4HaNzp4L4MppTyAmTxW8CH2Z0OmW0', 'Nick Stepuk', 'stfnco', 'twitter', '{"thread","quote","comment"}', 'https://x.com/stfnco', 'hello@stfn.co', 120000, 'bad'),
  ('Qvq4HaNzp4L4MppTyAmTxW8CH2Z0OmW0', 'Boring_Business', 'BoringBiz_', 'twitter', '{"quote"}', 'https://x.com/BoringBiz_', 'Veryboringbusiness@gmail.com', 70000, 'bad'),
  -- BAD (Rejected)
  ('Qvq4HaNzp4L4MppTyAmTxW8CH2Z0OmW0', 'Lian Lim', 'dashboardlim', 'twitter', '{"full"}', 'https://x.com/dashboardlim', 'hello@dashboard-lim.com', 120000, 'bad'),
  ('Qvq4HaNzp4L4MppTyAmTxW8CH2Z0OmW0', 'Kailash', 'kail_designs', 'twitter', '{"full"}', 'https://x.com/kail_designs', 'kailashsr38gmail.com', 75000, 'bad'),
  ('Qvq4HaNzp4L4MppTyAmTxW8CH2Z0OmW0', 'Ahmed', 'ahmedcreatives', 'twitter', '{"quote"}', 'https://x.com/ahmedcreatives', 'getahmed5@gmail.com', 130000, 'bad'),
  ('Qvq4HaNzp4L4MppTyAmTxW8CH2Z0OmW0', 'Tom Crawshaw', 'tomcrawshaw01', 'twitter', '{"full"}', 'https://x.com/tomcrawshaw01', NULL, 60000, 'bad'),
  ('Qvq4HaNzp4L4MppTyAmTxW8CH2Z0OmW0', 'Gizem Akdag', 'gizakdag', 'twitter', '{"full"}', 'https://x.com/gizakdag', 'hello@gizemakdag.com', 115000, 'bad'),
  ('Qvq4HaNzp4L4MppTyAmTxW8CH2Z0OmW0', 'Daily Loud', 'DailyLoud', 'twitter', '{"quote"}', 'https://x.com/DailyLoud', 'TheDailyLoud@gmail.com', 150000, 'bad'),
  ('Qvq4HaNzp4L4MppTyAmTxW8CH2Z0OmW0', 'Andrew Bolis', 'AndrewBolis', 'twitter', '{"thread"}', 'https://x.com/AndrewBolis', 'andrew@abdigital.cc', 150000, 'bad'),
  ('Qvq4HaNzp4L4MppTyAmTxW8CH2Z0OmW0', 'World of Statistics', 'stats_feed', 'twitter', '{"quote"}', 'https://x.com/stats_feed', 'statisticss.feed@gmail.com', 300000, 'bad'),
  ('Qvq4HaNzp4L4MppTyAmTxW8CH2Z0OmW0', 'greg16676935420', 'greg16676935420', 'twitter', '{"quote","comment"}', 'https://x.com/greg16676935420', 'greg16676935420@gmail.com', 450000, 'bad'),
  ('Qvq4HaNzp4L4MppTyAmTxW8CH2Z0OmW0', 'Salman Hamza', 'saluiux', 'twitter', '{"quote"}', 'https://x.com/saluiux', 'Salmanhamza811@gmail.com', 25000, 'bad'),
  ('Qvq4HaNzp4L4MppTyAmTxW8CH2Z0OmW0', 'Markandey Sharma', 'TechByMarkandey', 'twitter', '{"full"}', 'https://x.com/TechByMarkandey', 'markandey128@gmail.com', 30000, 'bad'),
  ('Qvq4HaNzp4L4MppTyAmTxW8CH2Z0OmW0', 'Crownz.UiUx', 'Crownzdesigns', 'twitter', '{"quote"}', 'https://x.com/Crownzdesigns', 'crownzdesigns@gmail.com', 40000, 'bad'),
  ('Qvq4HaNzp4L4MppTyAmTxW8CH2Z0OmW0', 'Nanouu Symeon', 'NanouuSymeon', 'twitter', '{"thread"}', 'https://x.com/NanouuSymeon', 'nakibarbie1017@gmail.com', 45000, 'bad');
