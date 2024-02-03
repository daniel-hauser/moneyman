import openai
import gspread
import urllib.request
from oauth2client.service_account import ServiceAccountCredentials
from bidi.algorithm import get_display
from urllib.parse import quote 
from datetime import datetime, timedelta
from collections import defaultdict
import operator

# Set up Google Sheets API credentials
scope = ["https://spreadsheets.google.com/feeds", "https://www.googleapis.com/auth/drive"]
creds = ServiceAccountCredentials.from_json_keyfile_name(
    "google.json", scope
)
client = gspread.authorize(creds)

def create_new_sheet():
    spreadsheet = client.open('ניסיון')
    current_date = datetime.now()
    first_day_of_current_month = current_date.replace(day=1)
    last_day_of_previous_month = first_day_of_current_month - timedelta(days=1)
    formatted_date = last_day_of_previous_month.strftime("%m/%y")
    worksheet = spreadsheet.worksheet('current')
    worksheet.update_title(formatted_date)
    new_sheet = spreadsheet.add_worksheet(title='current', rows=300, cols=11)
    column_titles = [
        'date', 'amount', 'description', 'memo', 'category', 'account',
        'hash', 'comment', 'scraped at', 'scraped by', 'identifier'
    ]

    new_sheet.update('A1:O1', [column_titles])
    print("New sheet created successfully!")
    
    spreadsheet = client.open('ניהול הוצאות הבית 2024')
    source_sheet = spreadsheet.worksheet('נוכחי')
    new_sheet = spreadsheet.duplicate_sheet(source_sheet.id, new_sheet_name=formatted_date)
    cell_formula = new_sheet.cell(3, 3, value_render_option='FORMULA').value
    new_formula = cell_formula.replace('current', formatted_date)
    new_sheet.update_cell(3, 3, new_formula)
    cell_formula = new_sheet.cell(3, 4, value_render_option='FORMULA').value
    new_formula = cell_formula.replace('current', formatted_date)
    new_sheet.update_cell(3, 4, new_formula)
    cell_formula = new_sheet.cell(3, 5, value_render_option='FORMULA').value
    new_formula = cell_formula.replace('current', formatted_date)
    new_sheet.update_cell(3, 5, new_formula)
    
    # clear מזומן
    range_to_clear = 'G3:G30'
    source_sheet.batch_clear([range_to_clear])

    values = [["~"], ["~"], ["~"], ["~"], ["~"], ["~"], ["~"], ["~"], ["~"], ["~"], ["~"], ["~"], ["~"], ["~"], ["~"], ["~"], ["~"], ["~"], ["~"], ["~"], ["~"], ["~"], ["~"], ["~"], ["~"], ["~"], ["~"]] 
    source_sheet.update("F3:F30", values)


def sum_category(sheet_name, sheet_title):
    sheet = client.open(sheet_name).worksheet(sheet_title)
    categories = defaultdict(float)
    for row in sheet.get_all_records():
        print(row['amount'])
        if row['amount']:
            amount = int(row['amount'])
        else:
            print("can't convert to int")
        category = row['category']
        categories[category] += amount
    sorted_categories = sorted(categories.items(), key=operator.itemgetter(1), reverse=True)
    message = ""
    message = u"✨ הוצאות לפי קטגוריות  ✨\n"
    for category, total in sorted_categories:
        message += f"{category}: {total}\n"
        print(message)
    message_encoded = quote(message)
    
    contents = urllib.request.urlopen("https://api.callmebot.com/whatsapp.php?phone=+972587994574&text=" + message_encoded + "&apikey=1236970").read()

def check_transactions(sheet_name, sheet1_title, sheet2_title):
    # Open the Google Sheet
    sheet1 = client.open(sheet_name).worksheet(sheet1_title)
    sheet2 = client.open(sheet_name).worksheet(sheet2_title)

    # Get all the values from both sheets
    values_sheet1 = sheet2.get_all_values()
    values_sheet2 = sheet1.get_all_values()

    # Assuming the data includes supplier and amount columns, you can extract them
    supplier_column = 3 
    amount_column = 2

    # Create dictionaries to store transactions by supplier and their amounts
    transactions_sheet1 = {}
    transactions_sheet2 = {}

   # Create a dictionary to keep track of the occurrences of each supplier
    supplier_count = {}

    # Populate the dictionaries from Sheet 1
    for row in values_sheet1[2:]:  # Skip the header row
        supplier = row[supplier_column]
        amount = float(row[amount_column])
        transactions_sheet1[supplier] = amount
        supplier_count[supplier] = supplier_count.get(supplier, 0) + 1

    # Initialize a message to store the result
    message = u"✨ הוצאות החודש שיותר גבוהות מחודש שעבר ✨\n"

    # Compare transactions in Sheet 2 with Sheet 1
    for row in values_sheet2[2:]:  # Skip the header row
        supplier = row[supplier_column]
        amount = float(row[amount_column])
        if supplier in transactions_sheet1 and supplier_count[supplier] == 1 and amount > transactions_sheet1[supplier]:
            message += f"עסקה מספק '{supplier}' בחודש '{sheet1_title}' עם סכום גבוה יותר מחודש '{sheet2_title}': {amount} > {transactions_sheet1[supplier]}\n"
        message_display = get_display(message)

    # Check if any such transactions were found
    if message_display:
        message
        result_message_encoded = quote(message)
        contents = urllib.request.urlopen("https://api.callmebot.com/whatsapp.php?phone=+972587994574&text=" + result_message_encoded + "&apikey=1236970").read()
    else:
        print("No transactions found in '{sheet2_title}' with higher amounts compared to '{sheet1_title}'.")

#sum_category("ניסיון", "current")

sheet_name = "ניהול הוצאות הבית 2023"
sheet1_title = "נוכחי"
current_date = datetime.now()
first_day_of_current_month = current_date.replace(day=1)
last_day_of_previous_month = first_day_of_current_month - timedelta(days=1)
formatted_date = last_day_of_previous_month.strftime("%m/%y")
print(formatted_date)
sheet2_title = formatted_date
#check_transactions(sheet_name, sheet1_title, sheet2_title)

create_new_sheet()
