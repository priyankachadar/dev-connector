const express = require("express");
const gravatar = require("gravatar");
const axios = require("axios");
const config = require("config");
const router = express.Router();
const auth = require('../../middleware/auth');
const {check , validationResult} = require('express-validator');
// bring in normalize to give us a proper url, regardless of what user entered
const normalize = require("normalize-url");



const Profile = require('../../models/Profile');
const User = require('../../models/User');
const Post = require('../../models/Post');



// get the users github avatar
const getGitHubAvatar = async (githubusername) => {
  const uri = encodeURI(`https://api.github.com/users/${githubusername}`);
  const headers = {
    "user-agent": "node.js",
    Authorization: `token ${config.get("githubToken")}`,
  };
  const gitHubResponse = await axios.get(uri, { headers });
  return gitHubResponse.data.avatar_url;
};


//@route Get api/profile/me
//@desc GET current users profile
//@acess private

router.get('/me',auth,async(req,res)=> {
  try {
    const profile = await Profile.findOne({
      user: req.user.id,
    });

    if (!profile) {
      return res.status(400).json({ msg: "There is no profile for this user" });
    }

    // only populate from user document if profile exists
    res.json(profile.populate("user", ["name", "avatar"]));
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server Error");
  }
});


//@route  Post api/profile
//@desc  create and update user profile
//@acess private

router.post('/' , [ 
    auth, 
    [

    check('status', 'staus is required')
    .not()
    .isEmpty(),
    check('skills', 'Skills is required')
    .not()
    .isEmpty()
]
],

async(req,res)=> {
    const errors = validationResult(req);
    if(!errors.isEmpty()){
        return res.status(404).json({errors: errors.array()});
    }
    
const{
    company,
    website,
    location,
    bio,
    status,
    githubusername,
    skills,
    youtube,
    facebook,
    twitter,
    instagram,
    linkedin,
    usegithubavatar,
} = req.body;


// Build profile object 

const profileFields = {
  user: req.user.id,
  company,
  location,
  website: website === "" ? "" : normalize(website, { forceHttps: true }),
  bio,
  skills: Array.isArray(skills)
    ? skills
    : skills.split(",").map((skill) => " " + skill.trim()),
  status,
  githubusername,
  usegithubavatar,
};
// Build social object and add to profileFields
const socialfields = { youtube, twitter, instagram, linkedin, facebook };

for (const [key, value] of Object.entries(socialfields)) {
  if (value && value.length > 0)
    socialfields[key] = normalize(value, { forceHttps: true });
}
profileFields.social = socialfields;

try {
  // update avatar
  let avatar;
  if (usegithubavatar) {
    // if usegithubavatar is true get the users github avatar
    avatar = await getGitHubAvatar(githubusername);
  } else {
    // else use Gravatar
    const user = await User.findOne({ _id: req.user.id });

    avatar = normalize(
      gravatar.url(user.email, {
        s: "200",
        r: "pg",
        d: "mm",
      }),
      { forceHttps: true }
    );
  }
  // update user's avatar url
  await User.findOneAndUpdate({ _id: req.user.id }, { avatar });

  // Using upsert option (creates new doc if no match is found):
  let profile = await Profile.findOneAndUpdate(
    { user: req.user.id },
    { $set: profileFields },
    { new: true, upsert: true }
  );

  res.json(profile);
} catch (err) {
  console.error(err.message);
  res.status(500).send("Server Error");
}
}
);
  

//@route GET api/profile
//@desc GET all profile
//@acess public
router.get('/', async (req, res) => {
    try {
      const profiles = await Profile.find().populate('user', ['name', 'avatar']);
      res.json(profiles);
    } catch (err) {
      console.error(err.message);
      res.status(500).send('Server Error');
    }
  });

  // @route    GET api/profile/user/:user_id
// @desc     Get profile by user ID
// @access   Public
router.get('/user/:user_id',async (req, res) => {
      try {
        const profile = await Profile.findOne({
          user: req.params.user_id
        }).populate('user', ['name', 'avatar']);
  
        if (!profile) return res.status(400).json({ msg: 'Profile not found' });
  
        return res.json(profile);
      } catch (err) {
        console.error(err.message);
        if(err.kind== 'ObjectId'){
        return res.status(400).json({ msg: 'Profile not found' });
        }
        return res.status(500).json({ msg: 'Server error' });
      }
    }
  );

// @route    DELETE api/profile
// @desc     Delete profile, user & posts
// @access   Private
router.delete('/', auth, async (req, res) => {
    try {
      // Remove user posts
      await Post.deleteMany({user: req.user.id });
     
       // Remove profile
      await  Profile.findOneAndRemove({ user: req.user.id }),
      // Remove user
      await  User.findOneAndRemove({ _id: req.user.id })
      
  
      res.json({ msg: 'User deleted' });
    } catch (err) {
      console.error(err.message);
      res.status(500).send('Server Error');
    }
  });
  
// @route    PUT api/profile/experience
// @desc     Add profile experience
// @access   Private

router.put(
    '/experience',
    [
    auth,
    [
    check('title', 'Title is required')
    .not()
    .isEmpty(),
    check('company', 'Company is required')
    .not()
    .isEmpty(),
    check('from', 'From date is required and needs to be from the past')
      .not()
      .isEmpty()
      .custom((value, { req }) => (req.body.to ? value < req.body.to : true)),
    ],
],

    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const {

            title,
            company,
            location,
            from,
            to,
            current,
            description,
        } = req.body;

        const newExp = {
            title,
            company,
            location,
            from,
            to,
            current,
            description,
        }

        try {
            const profile = await Profile.findOne({ user: req.user.id });

            profile.experience.unshift(newExp); // unshift take most recent is first

            await profile.save();
            res.json(profile);
        } catch (err) {
            console.error(err.message);
            res.status(500).send('Server Error');
        }
    }
  );


// @route    DELETE api/profile/experience/:exp_id
// @desc     Delete experience from profile
// @access   Private


router.delete('/experience/:exp_id', auth, async (req, res) => {
  try {
    const foundProfile = await Profile.findOne({ user: req.user.id });

    foundProfile.experience = foundProfile.experience.filter(
      (exp) => exp._id.toString() !== req.params.exp_id
    );

    await foundProfile.save();
    return res.status(200).json(foundProfile);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ msg: "Server error" });
  }
});


// @route    PUT api/profile/education
// @desc     Add profile education
// @access   Private

router.put(
  '/education',
  [
  auth,
  [
  check('school', 'School is required')
  .not()
  .isEmpty(),
  check('degree', 'Degree is required')
  .not()
  .isEmpty(),
  check('feildofstudy', 'Feildofstudy is required')
  .not()
  .isEmpty(),
  check('from', 'From date is required and needs to be from the past')
    .not()
    .isEmpty()
    .custom((value, { req }) => (req.body.to ? value < req.body.to : true)),
  ],
],

  async (req, res) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
          return res.status(400).json({ errors: errors.array() });
      }

      const {

          school,
          degree,
          feildofstudy,
          from,
          to,
          current,
          description,
      } = req.body;

      const newEdu = {
          
        school,
        degree,
        feildofstudy,
          from,
          to,
          current,
          description,
      }

      try {
        const profile = await Profile.findOne({ user: req.user.id });

        profile.education.unshift(newEdu);
  
        await profile.save();
  
        res.json(profile);
      } catch (err) {
        console.error(err.message);
        res.status(500).send("Server Error");
      }
    }
  );

// @route    DELETE api/profile/experience/:edu_id
// @desc     Delete education from profile
// @access   Private


router.delete('/education/:edu_id', auth, async (req, res) => {
  try {
    const foundProfile = await Profile.findOne({ user: req.user.id });
    foundProfile.education = foundProfile.education.filter(
      (edu) => edu._id.toString() !== req.params.edu_id
    );
    await foundProfile.save();
    return res.status(200).json(foundProfile);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ msg: "Server error" });
  }
});

// @route    DELETE api/profile/giithub/:username
// @desc     Get username from profile
// @access   Private

router.get('/github/:username', async(req, res)=>{
  try {
    const uri = encodeURI(
      `https://api.github.com/users/${req.params.username}/repos?per_page=5&sort=created:asc`
    );
    const headers = {
      "user-agent": "node.js",
      Authorization: `token ${config.get("githubToken")}`,
    };

    const gitHubResponse = await axios.get(uri, { headers });
    return res.json(gitHubResponse.data);
  } catch (err) {
    console.error(err.message);
    return res.status(404).json({ msg: "No Github profile found" });
  }
});


module.exports= router;