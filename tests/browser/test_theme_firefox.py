"""Dark theme and persisted overrides in the installed Firefox, clean profile."""
import json,os
from pathlib import Path
from selenium import webdriver
from selenium.webdriver.firefox.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait, Select
OUT=Path(__file__).resolve().parents[2]/'temp/browser-validation/theme';OUT.mkdir(parents=True,exist_ok=True)
options=Options();options.add_argument('-headless');options.set_preference('ui.systemUsesDarkTheme',1)
driver=webdriver.Firefox(options=options);driver.set_window_size(1440,1050);wait=WebDriverWait(driver,30)
def theme(value):wait.until(lambda d:d.find_element(By.TAG_NAME,'html').get_attribute('data-theme')==value)
try:
    driver.get(os.environ.get('NMT_THEME_URL','http://127.0.0.1:4299/'));wait.until(lambda d:not d.find_element(By.ID,'start-screen').is_displayed());theme('dark')
    root=driver.find_element(By.CSS_SELECTOR,'nextmedtator-assist').shadow_root
    root.find_element(By.CSS_SELECTOR,'[data-testid=assist-practice-p10]').click()
    driver.save_screenshot(str(OUT/'firefox-dark.png'))
    driver.find_element(By.LINK_TEXT,'Settings').click()
    choice=Select(driver.find_element(By.ID,'nmt-theme'));assert choice.first_selected_option.get_attribute('value')=='system'
    choice.select_by_value('light');theme('light');driver.refresh();wait.until(lambda d:not d.find_element(By.ID,'start-screen').is_displayed());theme('light')
    driver.find_element(By.LINK_TEXT,'Settings').click();Select(driver.find_element(By.ID,'nmt-theme')).select_by_value('system');theme('dark')
    driver.save_screenshot(str(OUT/'firefox-settings-dark.png'))
    result={'browser':'Installed Firefox','version':driver.capabilities['browserVersion'],'systemDefault':True,'overridePersists':True,'restoreSystem':True}
    (OUT/'firefox-report.json').write_text(json.dumps(result,indent=2));print(json.dumps(result))
finally:driver.quit()
