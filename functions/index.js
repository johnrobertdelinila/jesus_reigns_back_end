const functions = require('firebase-functions');
const admin = require('firebase-admin');
const path = require('path');

const serviceAccount = './serviceAccountKey.json';
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://jesus-reigns-ministries.firebaseio.com",
  storageBucket: "jesus-reigns-ministries.appspot.com"
});

const mAuth = admin.auth();
const mDb = admin.firestore();

const users = mDb.collection('users');
const lineups = mDb.collection('lineup');
const songs_doc = mDb.collection('songs');


exports.setCustomClaims = functions.https.onCall((data, context) => {
	// Get the data string.
	const uid = context.auth.uid;

	// Checking that the user is authenticated.
	if (!context.auth) {
		throw new functions.https.HttpsError('failed-precondition', 'The function must be called while authenticated');
	}

	// Check if the data is valid.
	if (!(typeof uid === 'string') || uid.length === 0) {
		throw new functions.https.HttpsError('invalid-argument', 'The function must be called with at least one argument to add.');
	}

	return mAuth.setCustomUserClaims(uid, data)
		.then(() => {
			console.log("User successfully updated custom claims.");
			return true;
		})
		.catch(err => {
			throw new functions.https.HttpsError('unknown', err.message, err);
		});

});

exports.saveDownloadUrlImage = functions.region('asia-northeast1').storage.object().onFinalize(object => {
	const contentType = object.contentType;
	if (!contentType.startsWith('image/')) {
		console.log('The uploaded file was not an image.');
		return null;
	}

	const filePath = object.name;
	const fileDir = path.dirname(filePath);

	const fileBucket = object.bucket;
	const fileName = path.basename(filePath);

	const bucket = admin.storage().bucket(fileBucket);

	const SIGNED_BUCKET_URL_CONFIG = {
	    action: 'read',
	    expires: '03-01-2500'
	};

	if (fileDir !== null && fileDir === "message") {
		console.log("Image is from chat image.");
		console.log("File Name: ", fileName);
		const arrFileName = fileName.split("*****");
		const lineupId= arrFileName[0];
		const msgId = arrFileName[1].split(".")[0];

		return bucket.file(filePath).getSignedUrl(SIGNED_BUCKET_URL_CONFIG, (err, url) => {                                  
			if (err) {
	            console.error(err);
	            return null;
	        }else {
	        	return lineups.doc(lineupId).collection('message').doc(msgId).update({imgUrl: url})
	        		.then(() => console.log("Successfully updated the image url of message."))
	        		.catch(error => {
	        			throw new functions.https.HttpsError('unknown', error.message, error);
	        		});
	        }                                         
		});

	}else {
		console.log("The image was not message image.");
		return null;
	}
});


exports.getUserRecord = functions.https.onCall((data, context) => {
	// Get the data string.
	const uid = data.uid;

	// Checking that the user is authenticated.
	if (!context.auth) {
		throw new functions.https.HttpsError('failed-precondition', 'The function must be called while authenticated');
	}

	// Check if the data is valid.
	if (!(typeof uid === 'string') || uid.length === 0) {
		throw new functions.https.HttpsError('invalid-argument', 'The function must be called with one arguments "text" containing the message text to add.');
	}

	// Getting the user information.
	return mAuth.getUser(uid)
		.then(userRecord => {
			console.log(userRecord.toJSON());
			return {
				displayName: userRecord.displayName,
				photoURL: userRecord.photoURL
			}
		})
		.catch(error => {
			throw new functions.https.HttpsError('unknown', error.message, error);
		});

});

exports.listAllUsers = functions.https.onCall((data, context) => {

	if (!context.auth) {
		throw new functions.https.HttpsError('failed-precondition', 'The function must be called while authenticated');
	}

	return mAuth.listUsers()
		.then(listUsersResult => {
			return listUsersResult.users;
		})
		.catch(err => {
			throw new functions.https.HttpsError('unknown', err.message, err);
		});
});

exports.sendInviteUserNotification = functions.firestore.document("lineup/{line_up_id}").onCreate((snap, context) => {
	const line_up = snap.data();

	const notification = {
		collection: 'notifications',
		doc_id: context.params.line_up_id,
		user_metadata: {
			uid: line_up.uid
		},
		title: 'Lineup Invitation',
		data: line_up,
		timestamp: admin.firestore.FieldValue.serverTimestamp()
	};

	return mAuth.getUser(line_up.uid)
		.then(userRecord => {
			notification.user_metadata.image = userRecord.toJSON().photoURL;
			notification.content = userRecord.toJSON().displayName + " have invited you for the Line Up";
			const promises = [];
			line_up.invited_uids.forEach(uid => {
				promises.push(users.doc(uid).collection('notifications').add(notification));
			});
			return Promise.all(promises);
		})
		.then((results) => {
			console.log('Successfully add all new notifications to users');
			return null;
		})
		.catch(err => console.log(err.message));

});

exports.updateUserCalendar = functions.firestore.document("lineup/{line_up_id}")
	.onUpdate((change, context) => {
		const new_line_up = change.after.data();
		const previous_line_up = change.before.data();

		const new_response = new_line_up.response || null;
		const previous_response = previous_line_up.response || null;
		if (previous_response === null && new_response !== null) {
			const uid = getTheNewUid(previous_response, new_response);
			return updateCalendar(uid, new_line_up.events, context.params.line_up_id);
		}else if (new_response !== null && isNewHigher(previous_response, new_response)) {
			const uid = getTheNewUid(previous_response, new_response);
			if (uid !== null) {
				return updateCalendar(uid, new_line_up.events, context.params.line_up_id);
			}else {
				return null;
			}
		}else {
			return null;
		}
	});

exports.updateNotificationResolved = functions.firestore.document("lineup/{line_up_id}")
	.onUpdate((change, context) => {
		const new_line_up = change.after.data();
		const previous_line_up = change.before.data();

		const new_response = new_line_up.response || null;
		const previous_response = previous_line_up.response || null;
		if (previous_response === null && new_response !== null) {
			const uid = getTheNewUid(previous_response, new_response);
			return updateNotificationToResolved(uid, context.params.line_up_id);
		}else if (new_response !== null && isNewHigher(previous_response, new_response)) {
			const uid = getTheNewUid(previous_response, new_response);
			if (uid !== null) {
				return updateNotificationToResolved(uid, context.params.line_up_id);
			}else {
				return null;
			}
		}else {
			return null;
		}
	});

exports.sendInviteLineUpNotification = functions.firestore.document("lineup/{line_up_id}").onCreate((snap, context) => {

	const line_up = snap.data();
	const from_user_id = line_up.uid;
	const invited_uids = line_up.invited_uids || null;

	var from_data = null;
	const tokens = [];

	return mAuth.getUser(from_user_id)
		.then(userRecord => {
			from_data = userRecord.toJSON();
			const promises_token = [];
			if (invited_uids !== null && invited_uids.length > 0) {
				invited_uids.forEach(invited_uid => {
					promises_token.push(users.doc(invited_uid).get());
				});
			}
			return Promise.all(promises_token);
		})
		.then(snapshots => {
			snapshots.forEach(snapshot => {

			 	if (snapshot !== undefined && snapshot !== null) {
			 		const user = snapshot.data() || null;
			 		if (user !== undefined && user !== null) {
			 			const fcmToken = user.fcmToken || null;
			 			if (fcmToken !== undefined && fcmToken !== null) {
			 				tokens.push(fcmToken);
			 			}
			 		}
			 	}
	
			});


			const payload = {
                data: {
                    lineup_id: context.params.line_up_id,
                    from_id: from_data.uid,
                    from_name: from_data.displayName,
                    from_image: from_data.photoURL,
                    title: from_data.displayName,
					channel_name: "Hify Posts",
                    body: "Sent you a Line Up Invitation",
                    friend_id: from_data.uid,
                    friend_name: from_data.displayName || "",
                    friend_email: from_data.email || "",
                    friend_image: from_data.photoURL,
                    notification_type: "like",
                    timestamp: line_up.timestamp,
                    click_action: "TARGATLINEUPSONGS"
                },
                notification: {
                    lineup_id: context.params.line_up_id,
                    from_id: from_data.uid,
                    from_name: from_data.displayName,
                    from_image: from_data.photoURL,
                    title: from_data.displayName,
					channel_name: "Hify Posts",
                    body: "Sent you a Line Up Invitation",
                    friend_id: from_data.uid,
                    friend_name: from_data.displayName || "",
                    friend_email: from_data.email || "",
                    friend_image: from_data.photoURL,
                    notification_type: "like",
                    timestamp: line_up.timestamp,
                    click_action: "TARGATLINEUPSONGS"
                }
            };

            console.log(" | from: " + from_data.displayName + " | to:" + invited_uids + " | message: | Sent line up invitation");

			// Send notifications to all tokens.
			return admin.messaging().sendToDevice(tokens, payload);

		})
		.then(response => {
			response.results.forEach((result, index) => {
				const error = result.error;
			    if (error) {
			        console.error('Failure sending notification to', tokens[index], error);
			        // Cleanup the tokens who are not registered anymore.
			        if (error.code === 'messaging/invalid-registration-token' ||
			            error.code === 'messaging/registration-token-not-registered') {
			        	console.log("Error token: ", tokens[index], error);
			        }
			    }
			    else {
			        console.log("Successfully sent notification to: ", tokens[index], response);
			    }
			});

			return null;
		})
		.catch(err => console.log(err.message));

});

exports.deleteAllNotification = functions.https.onCall((data, context) => {

	// Get the data string.
	const uid = data.uid;

	// Checking that the user is authenticated.
	if (!context.auth) {
		throw new functions.https.HttpsError('failed-precondition', 'The function must be called while authenticated');
	}

	// Check if the data is valid.
	if (!(typeof uid === 'string') || uid.length === 0) {
		throw new functions.https.HttpsError('invalid-argument', 'The function must be called with one arguments "text" containing the message text to add.');
	}

	const collectionRef = users.doc(uid).collection('notifications');

	return deleteCollection(collectionRef, 20);
	
});

exports.showLineUpSong = functions.https.onCall((data, context) => {
	// Get the data string.
	const uid = data.uid;
	const docId = data.docId;

	// Checking that the user is authenticated.
	if (!context.auth) {
		throw new functions.https.HttpsError('failed-precondition', 'The function must be called while authenticated');
	}

	// Check if the data is valid.
	if (!(typeof uid === 'string') || uid.length === 0) {
		throw new functions.https.HttpsError('invalid-argument', 'The function must be called with one arguments "text" containing the message text to add.');
	}

	const lineup_songs = {};
	const peoples = [];
	var lineup;

	return lineups.doc(docId).get()
		.then(snapshot => {
			lineup = snapshot.data();
			
			const songs = lineup.songs;
			const song_promises = [];
			for (var type in songs) {
			    if (!songs.hasOwnProperty(type)) continue;

			   	songs[type].forEach(id => {
			   		song_promises.push(songs_doc.doc(id).get());
			   	});
			}

			return Promise.all(song_promises);
		})
		.then(results => {

			const songs = lineup.songs;

			for (var type in songs) {
			    if (!songs.hasOwnProperty(type)) continue;

			    var total_ids = "";
			    var total_titles = "";
			   	for (var i = 0; i < songs[type].length; i++) {
			   		total_ids += songs[type][i];
			   		total_titles += getSongTitle(results, songs[type][i]);
			   		if (i !== ((songs[type].length) - 1)) {
			   			total_ids += "*****";
			   			total_titles += ", ";
			   		}
			   	}
			   	lineup_songs[type] = {
			   		'id': total_ids,
			   		'title': total_titles
			   	}
			}

			return mAuth.listUsers();

		})
		.then(listUsersResult => {
			listUsersResult.users.forEach(userRecord => {
				const user = userRecord.toJSON();

				if (lineup.invited_uids.includes(user.uid) || user.uid === lineup.uid) {
					const customClaims = user.customClaims || null;
					var ministry = null;
					if (customClaims !== null) {
						ministry = customClaims.ministry;
					}

					const people = {
						displayName: user.displayName,
						uid: user.uid,
						ministry: ministry,
						photoURL: user.photoURL
					}
					peoples.push(people);
				}
			});

			lineup_songs['events'] = lineup.events;

			// Get the response

			var userResponse = null;
			if (lineup.response !== null && lineup.response !== undefined) {
				if (lineup.response.hasOwnProperty(uid)) {
					userResponse = lineup.response[uid]; 
				}
			}

			return {
				lineup_songs: lineup_songs,
				peopleList: peoples,
				userResponse: userResponse
			}
		})
		.catch(err => {
			console.log('error: ', err);
			throw new functions.https.HttpsError('unknown', err.message, err);
		});
});

function updateCalendar(uid, events, line_up_id) {

	const promises = [];
	for (var type in events) {
		if (type.date !== "Select Date" && type.time !== "Select Time") {
			const calendar = {
				date: type.date,
				time: type.time,
				timestamp: admin.firestore.FieldValue.serverTimestamp(),
				title: 'Lineup ' + type.charAt(0).toUpperCase() + type.slice(1),
				line_up_id: line_up_id
			}
			promises.add(users.doc(uid).collection('calendar').add(calendar));
		}
	}

	return Promise.all(promises);
}

function updateNotificationToResolved(uid, docId) {
	return users.doc(uid).collection('notifications').where('doc_id', '==', docId).limit(1)
		.get()
		.then(querySnapshot => {
			if (querySnapshot !== null && !querySnapshot.empty) {
				return querySnapshot.forEach(doc => {
					return users.doc(uid).collection('notifications').doc(doc.id).set({
						isResolved: true
					}, {merge: true});
				});
			}else {
				console.log("Query result returned null");
				return null;
			}
		})
		.catch(err => console.log(err));
}

function getTheNewUid(previous, newest) {
	var uid = null;
	for (var key in newest) {
		const newValue = newest[key];
		if (newValue === 'accept' && (previous === null || (!previous.hasOwnProperty(key) || previous[key] === 'decline'))) {
			uid = key;
			break;
		}
	}
	return uid;
}

function isNewHigher(previous, newest) {
	const old_size = count(previous);
	const new_size = count(newest);
	if (new_size > old_size) {
		return true;
	}else {
		return false;
	}
}

function count(obj) {
	var result = 0;
	if (obj !== null) {
		for (var key in obj) {
			const response = obj[key];
			if (response === 'accept') {
				result++;
			}
		}
	}
	return result;
}

function getSongTitle(docs, docId) {
	var output = "(Deleted)";
	if (docs.length > 0) {
		for (var i = 0; i < docs.length; i++) {
			const doc = docs[i];
			if (doc !== undefined && doc !== null && docId !== null && doc.id === docId) {
				output = doc.data().title || "";
				break;
			}
		}
	}

	return output;
}

function deleteCollection(collectionRef, batchSize) {
	let query = collectionRef.where("isSeen", "==", true).limit(batchSize);

	return new Promise((resolve, reject) => {
		deleteQueryBatch(query, batchSize, resolve, reject);
	});
}

function deleteQueryBatch(query, batchSize, resolve, reject) {
	query.get()
		.then((snapshot) => {
		  	// When there are no documents left, we are done
			if (snapshot.size === 0) {
				return 0;
		  	}

		  	// Delete documents in a batch
			let batch = mDb.batch();
		  	snapshot.docs.forEach((doc) => {
		    	batch.delete(doc.ref);
		  	});

		  	return batch.commit().then(() => {
		    	return snapshot.size;
		  	});
		}).then((numDeleted) => {
	  		if (numDeleted === 0) {
	    		resolve();
		    	return;
		  	}

		  	// Recurse on the next process tick, to avoid
		  	// exploding the stack.
		  	return process.nextTick(() => {
		    	return deleteQueryBatch(query, batchSize, resolve, reject);
		  	});
		})
		.catch(reject);
}