module.exports = {
  // Role given to a member while their LOA is active
  LOA_ROLE_ID: '1540144689821393059',

  // Role required to run /requestloa (i.e. your general staff role)
  STAFF_ROLE_ID: '1471686039021027338,1471685460064469124',

  // Role required to run /endloa, /activeloa, /loahistory, and to
  // click Approve/Decline on pending requests (management/HR role)
  LOA_MANAGER_ROLE_ID: '1471629811221794827',

  // Channel where new LOA requests are posted for approval/decline
  LOA_REQUEST_CHANNEL_ID: '1540145718487158834',

  // Channel where "LOA started" / "LOA ended" logs are posted
  // (can be the same channel as LOA_REQUEST_CHANNEL_ID if you want)
  LOG_CHANNEL_ID: '1538641855267209236',
};